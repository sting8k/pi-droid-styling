import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  copyToClipboard,
} from "@earendil-works/pi-coding-agent";

import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installStartupUiPatch, setCompactStartupHeader, suppressStartupModelScopeLog } from "./startup-ui.js";

type SessionModules = typeof import("./session-modules.js");
type AssistantSpeedTracker = ReturnType<SessionModules["createAssistantSpeedTracker"]>;
type WorkingLoaderController = ReturnType<SessionModules["createWorkingLoaderController"]>;
type WorkingStateForAssistantMessage = SessionModules["workingStateForAssistantMessage"];
type SetAssistantUpdateRenderRequester = SessionModules["setAssistantUpdateRenderRequester"];
type RenderFrameDebugModule = typeof import("./performance/render-frame-debug.js");

let syncThemeExtrasForCurrentSession: ((force?: boolean) => void) | undefined;
let disposeFixedUserZoneForCurrentSession: (() => void) | undefined;
let restoreTerminalBackgroundForCurrentSession: (() => void) | undefined;
let disposePiTasksWidgetStylingForCurrentSession: (() => void) | undefined;
const FORCE_THEME_SCAN_INTERVAL_MS = 1000;
const FIXED_ZONE_SCROLL_FRAME_MS = 20;
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
let setAssistantUpdateRenderRequesterForCurrentSession: SetAssistantUpdateRenderRequester | undefined;
let sessionModulesPromise: Promise<SessionModules> | undefined;

let renderFrameDebugModulePromise: Promise<RenderFrameDebugModule> | undefined;
function loadSessionModules(): Promise<SessionModules> {
	sessionModulesPromise ??= import("./session-modules.js");
	return sessionModulesPromise;
}

function loadRenderFrameDebugModule(): Promise<RenderFrameDebugModule> {
	renderFrameDebugModulePromise ??= import("./performance/render-frame-debug.js");
	return renderFrameDebugModulePromise;
}

function isProfileEnabled(env = process.env): boolean {
	return TRUE_ENV_VALUES.has(String(env.PI_DROID_PROFILE ?? "").trim().toLowerCase());
}

let profilerModulePromise: Promise<typeof import("./performance/profiler.js")> | undefined;

function loadProfilerModule(): Promise<typeof import("./performance/profiler.js")> {
	profilerModulePromise ??= import("./performance/profiler.js");
	return profilerModulePromise;
}

function profileCount(name: string, value?: number): void {
	if (!isProfileEnabled()) return;
	void loadProfilerModule().then((profiler) => profiler.profileCount(name, value));
}

function flushProfile(reason: string): void {
	if (!isProfileEnabled()) return;
	void loadProfilerModule().then((profiler) => profiler.flushProfile(reason));
}

function isRemoteClipboardSession(env = process.env): boolean {
	// jump's browser terminal receives clipboard writes through OSC 52, but
	// jump sessions are local PTYs, not necessarily SSH/MOSH sessions.
	return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.MOSH_CONNECTION || env.TERM_PROGRAM === "jump");
}

export default function (pi: ExtensionAPI) {
	suppressStartupModelScopeLog();
	installStartupUiPatch(InteractiveMode);
	let sessionRunSerial = 0;
	let toolCallTagsRegistration: Promise<void> | undefined;
	const ensureToolCallTagsRegistered = () => {
		toolCallTagsRegistration ??= registerToolCallTags(pi).catch((error) => {
			toolCallTagsRegistration = undefined;
			throw error;
		});
		return toolCallTagsRegistration;
	};

	let currentThinkingLevel: string | undefined;
	let assistantSpeedTracker: AssistantSpeedTracker | undefined;
	let workingStateForAssistantMessageForCurrentSession: WorkingStateForAssistantMessage | undefined;
	let workingLoaderController: WorkingLoaderController | undefined;
	const runningToolCalls = new Set<string>();

	const isStaleContextError = (error: unknown): boolean =>
		error instanceof Error && error.message.includes("stale after session replacement or reload");

	pi.on("before_agent_start", () => {
		workingLoaderController?.setState("working");
	});

	pi.on("agent_start", () => {
		runningToolCalls.clear();
		workingLoaderController?.start("working");
	});

	pi.on("message_start", (event) => {
		assistantSpeedTracker?.handleMessageStart(event.message);
		if (event.message.role === "assistant" && runningToolCalls.size === 0) {
			workingLoaderController?.setState(workingStateForAssistantMessageForCurrentSession?.(event.message) ?? "answering");
		}
	});

	pi.on("message_update", (event) => {
		assistantSpeedTracker?.handleMessageUpdate(event.message);
		if (event.message.role === "assistant" && runningToolCalls.size === 0) {
			workingLoaderController?.setState(workingStateForAssistantMessageForCurrentSession?.(event.message) ?? "answering");
		}
	});

	pi.on("thinking_level_select", (event) => {
		currentThinkingLevel = event.level;
	});

	pi.on("message_end", (event) => {
		assistantSpeedTracker?.handleMessageEnd(event.message);
	});

	pi.on("tool_execution_start", (event) => {
		runningToolCalls.add(event.toolCallId);
		workingLoaderController?.setState("running");
	});

	pi.on("tool_execution_end", (event) => {
		runningToolCalls.delete(event.toolCallId);
		// Keep the current label until the next live state begins.
		// For example, a completed tool stays "Cooking" until assistant streaming resumes.
	});

	pi.on("agent_end", () => {
		runningToolCalls.clear();
		workingLoaderController?.stop();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionRunSerial++;
		profileCount("session.shutdown");
		flushProfile("session_shutdown");
		syncThemeExtrasForCurrentSession = undefined;
		restoreTerminalBackgroundForCurrentSession?.();
		restoreTerminalBackgroundForCurrentSession = undefined;
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
		setAssistantUpdateRenderRequesterForCurrentSession?.(undefined);
		workingLoaderController?.dispose();
		workingLoaderController = undefined;
		disposePiTasksWidgetStylingForCurrentSession?.();
		disposePiTasksWidgetStylingForCurrentSession = undefined;
		runningToolCalls.clear();
		try {
			ctx.ui.setEditorComponent(undefined);
		} catch {
			// Best effort: shutdown happens during session replacement.
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const sessionRun = ++sessionRunSerial;
		const isCurrentSessionRun = () => sessionRun === sessionRunSerial;
		profileCount("session.start");
		const modules = await loadSessionModules();
		if (!isCurrentSessionRun()) return;
		assistantSpeedTracker ??= modules.createAssistantSpeedTracker();
		const tracker = assistantSpeedTracker;
		workingStateForAssistantMessageForCurrentSession = modules.workingStateForAssistantMessage;
		setAssistantUpdateRenderRequesterForCurrentSession = modules.setAssistantUpdateRenderRequester;
		modules.installCompactToolSpacing();
		modules.installDefaultBadge();
		modules.installQuickEditRenderer(ToolExecutionComponent);
		modules.installMarkdownCodeBlockRenderer();
		modules.installFooterStatsPatch();
		modules.installCoreMessageBlockStyling({
			CompactionSummaryMessageComponent,
			SkillInvocationMessageComponent,
			BranchSummaryMessageComponent,
			CustomMessageComponent,
		});
		const sessionUi = ctx.ui;
		const sessionCwd = ctx.cwd;
		modules.setAssistantUpdateRenderRequester(undefined);
		setCompactStartupHeader(sessionUi, sessionCwd);
		tracker.resetSession();
		workingLoaderController?.dispose();
		workingLoaderController = undefined;
		runningToolCalls.clear();
		try {
			currentThinkingLevel = pi.getThinkingLevel();
		} catch (error) {
			if (!isStaleContextError(error)) throw error;
			currentThinkingLevel = undefined;
		}
		const config = modules.loadConfig();
		await ensureToolCallTagsRegistered();
		if (!isCurrentSessionRun()) return;
		const fixedZoneModules = config.fixedUserZone
			? await Promise.all([
				import("./fixed-zone/install.js"),
				import("./fixed-zone/theme.js"),
				import("./core/pi-version.js"),
				import("./core/session-metadata.js"),
			])
			: undefined;
		if (!isCurrentSessionRun()) return;
		const renderFrameDebugModule = process.env.PI_DROID_RENDER_DEBUG === "1"
			? await loadRenderFrameDebugModule()
			: undefined;
		if (!isCurrentSessionRun()) return;
		const userZoneStyle = modules.resolveUserZoneStyle(config.userZoneStyle);
		disposePiTasksWidgetStylingForCurrentSession?.();
		disposePiTasksWidgetStylingForCurrentSession = modules.installPiTasksWidgetStyling(sessionUi, config.tasksWidgetStyle);
		restoreTerminalBackgroundForCurrentSession?.();
		restoreTerminalBackgroundForCurrentSession = undefined;
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
		workingLoaderController = modules.createWorkingLoaderController(sessionUi, config.customWorkingMessage);
		workingLoaderController.configure();

		// Treat `alwaysExpanded` as the session-start preference only.
		// Ctrl+o remains authoritative after the session is initialized.
		const initialToolsExpanded = Boolean(config.alwaysExpanded);
		if (sessionUi.getToolsExpanded() !== initialToolsExpanded) {
			sessionUi.setToolsExpanded(initialToolsExpanded);
		}

		// No setTheme() call — use whatever theme is selected in settings
		modules.installAssistantStreamingMarkdownCache(AssistantMessageComponent);
		modules.installAssistantMessagePrefix(sessionUi.theme);
		modules.installUserMessagePrefix(sessionUi.theme);
		modules.installAssistantUpdateDebounce(AssistantMessageComponent);
		modules.installToolExecutionUpdateDebounce(ToolExecutionComponent);
		modules.installFinishedRenderCache(AssistantMessageComponent, ToolExecutionComponent);

		let lastForcedThemeScanAt = 0;
		const syncThemeExtras = (force = false) => {
			if (force) {
				const now = Date.now();
				if (lastForcedThemeScanAt > 0 && now - lastForcedThemeScanAt < FORCE_THEME_SCAN_INTERVAL_MS) {
					force = false;
				} else {
					lastForcedThemeScanAt = now;
				}
			}
			modules.setFullTheme(sessionUi.theme, force);
		};
		syncThemeExtrasForCurrentSession = syncThemeExtras;
		syncThemeExtras(true);

		const interactiveModePrototype = InteractiveMode.prototype as any;
		const originalUpdateEditorBorderColor = interactiveModePrototype.updateEditorBorderColor;
		// Keep the legacy marker name so extension reloads do not stack wrappers.
		if (typeof originalUpdateEditorBorderColor === "function" && !originalUpdateEditorBorderColor.__droidTerminalThemeSync) {
			const wrappedUpdateEditorBorderColor = function (this: any, ...args: any[]) {
				syncThemeExtrasForCurrentSession?.(true);
				return originalUpdateEditorBorderColor.apply(this, args);
			};
			(wrappedUpdateEditorBorderColor as any).__droidTerminalThemeSync = true;
			interactiveModePrototype.updateEditorBorderColor = wrappedUpdateEditorBorderColor;
		}

		modules.setDefaultBadgeTheme(sessionUi.theme);
		modules.setToolSpacingTheme(sessionUi.theme);
		modules.setCoreMessageBlockTheme(sessionUi.theme);

		sessionUi.setEditorComponent((tui, theme, kb) => {
			const uiTheme = (sessionUi.theme ?? theme) as any;
			restoreTerminalBackgroundForCurrentSession?.();
			restoreTerminalBackgroundForCurrentSession = modules.applyTerminalPageBackgroundOsc11(uiTheme, (tui as any).terminal as any, { force: config.forceOSC11 });
			modules.installRenderThrottle(tui as any);
			modules.setAssistantUpdateRenderRequester(() => tui.requestRender());
			modules.virtualizeChatContainer(tui as any, config.visibleChatTail);
			modules.installTuiPadding(tui as any);
			modules.installRenderAutowrapGuard(tui as any);
			let fixedZoneSidebarActive = false;
			let fixedZoneSelectionCopySerial = Promise.resolve();
			let fixedZoneSelectionCopySeq = 0;
			const fetchBranch = modules.createGitBranchFetcher(sessionCwd, () => tui.requestRender());
			if (fixedZoneModules) {
				const [{ installFixedUserZone }, { createFixedZoneTheme }, { getPiVersion }, { readSessionMetadata }] = fixedZoneModules;
				const piVersion = getPiVersion();
				const fixedZoneTheme = createFixedZoneTheme(uiTheme);
				disposeFixedUserZoneForCurrentSession = installFixedUserZone(sessionUi as any, tui as any, {
					enabled: config.fixedUserZone,
					onCopySelection: (text, clipboard) => {
						const copySeq = ++fixedZoneSelectionCopySeq;
						const terminalClipboardEmitted = clipboard.emitOsc52Clipboard();
						if (terminalClipboardEmitted) clipboard.showNotice("success", "Selected text copied to clipboard");

						fixedZoneSelectionCopySerial = fixedZoneSelectionCopySerial
							.catch(() => undefined)
							.then(() => copyToClipboard(text))
							.then(
								() => {
									if (copySeq !== fixedZoneSelectionCopySeq) return;
									if (terminalClipboardEmitted) return; // optimistic success already shown
									const remoteClipboard = isRemoteClipboardSession();
									const fallbackOsc52Emitted = clipboard.emitOsc52Clipboard();
									clipboard.showNotice(
										remoteClipboard && !fallbackOsc52Emitted ? "warning" : "success",
										remoteClipboard && !fallbackOsc52Emitted ? "Copy failed" : "Selected text copied to clipboard",
									);
								},
								() => {
									if (copySeq !== fixedZoneSelectionCopySeq) return;
									const fallbackOsc52Emitted = terminalClipboardEmitted || clipboard.emitOsc52Clipboard();
									clipboard.showNotice(
										fallbackOsc52Emitted ? "warning" : "error",
										fallbackOsc52Emitted ? "Copy may not work in all applications" : "Copy failed",
									);
								},
							);
					},
					requestScrollRender: () => modules.requestRenderWithFrameMs(tui, FIXED_ZONE_SCROLL_FRAME_MS),
					theme: fixedZoneTheme,
					scrollFrameMs: FIXED_ZONE_SCROLL_FRAME_MS,
					userZoneStyle,
					getShortcutHintPrefix: modules.getFooterTokenUsageLine,
					sidebar: {
						enabled: false,
						theme: fixedZoneTheme,
						onActiveChange: (active) => { fixedZoneSidebarActive = active; },
						getInfo: () => {
							const git = fetchBranch();
							const sessionMetadata = readSessionMetadata(ctx);
							return {
								sessionId: sessionMetadata.id,
								sessionName: sessionMetadata.name,
								cwd: sessionCwd,
								branch: git?.branch,
								insertions: git?.insertions,
								deletions: git?.deletions,
								modifiedFiles: git?.modifiedFiles,
								piVersion,
							};
						},
					},
				});
			}
			modules.installRenderWidthGuard(tui as any);
			modules.installRenderFrameBackground(tui as any, uiTheme);
			modules.installRenderPhysicalSync(tui as any);
			renderFrameDebugModule?.installRenderFrameDebug(tui as any);
			return new modules.BoxEditor(
				tui, theme, kb, uiTheme, sessionCwd,
				() => {
					try {
						return ctx.getContextUsage();
					} catch (error) {
						if (isStaleContextError(error)) return undefined;
						throw error;
					}
				},
				() => {
					try {
						const model = ctx.model;
						return model
							? {
								provider: model.provider,
								id: model.id,
								name: (model as typeof model & { name?: string }).name,
								reasoning: model.reasoning,
								thinkingLevel: currentThinkingLevel,
							}
							: undefined;
					} catch (error) {
						if (isStaleContextError(error)) return undefined;
						throw error;
					}
				},
				fetchBranch,
				() => tracker.getWordsPerSecond(),
				modules.getFooterStatusLine,
				() => fixedZoneSidebarActive ? "sidebar" : "footer",
				userZoneStyle,
				config.inputBox.style,
				config.fixedUserZone ? () => null : modules.getFooterTokenUsageLine,
			);
		});
	});
}
