import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, copyToClipboard, InteractiveMode, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
import { FIXED_ZONE_SCROLL_FRAME_MS, installFixedUserZone } from "./fixed-zone/install.js";
import { createFixedZoneTheme } from "./fixed-zone/theme.js";
import { createAssistantSpeedTracker } from "./core/assistant-speed.js";
import { createGitBranchFetcher } from "./core/git-status.js";
import { getPiVersion } from "./core/pi-version.js";
import { readSessionMetadata } from "./core/session-metadata.js";
import { installAssistantUpdateDebounce, setAssistantUpdateRenderRequester } from "./performance/debounce-update.js";
import { installToolExecutionUpdateDebounce } from "./performance/debounce-tool-updates.js";
import { installFinishedRenderCache } from "./performance/finished-render-cache.js";
import { loadConfig } from "./config.js";
import { installAssistantMessagePrefix } from "./messages/assistant-prefix.js";
import { installMarkdownCodeBlockRenderer } from "./messages/markdown-codeblock-renderer.js";
import { installAssistantStreamingMarkdownCache } from "./messages/streaming-markdown-cache.js";
import { installUserMessagePrefix } from "./messages/user-prefix.js";
import { installRenderFrameDebug } from "./performance/render-frame-debug.js";
import { installRenderAutowrapGuard } from "./performance/render-autowrap-guard.js";
import { installRenderFrameBackground } from "./performance/render-frame-background.js";
import { installRenderPhysicalSync } from "./performance/render-physical-sync.js";
import { installRenderThrottle, requestRenderWithFrameMs } from "./performance/render-throttle.js";
import { installRenderWidthGuard } from "./performance/render-width-guard.js";
import { setFullTheme } from "./theme/theme-extras.js";
import { applyTerminalPageBackgroundOsc11 } from "./theme/terminal-background.js";
import { installCompactToolSpacing, setToolSpacingTheme } from "./tool-tags/compact-tool-spacing.js";
import { installDefaultBadge, setDefaultBadgeTheme } from "./tool-tags/default-badge.js";
import { installQuickEditRenderer } from "./tool-tags/quick-edit.js";
import { createWorkingLoaderController, workingStateForAssistantMessage, type WorkingLoaderController } from "./tool-tags/loader-accent.js";
import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installTuiPadding } from "./tui-padding.js";
import { getFooterStatusLine, installFooterStatsPatch } from "./footer-patch.js";
import { virtualizeChatContainer } from "./performance/virtualize-chat.js";
import { flushProfile, profileCount } from "./performance/profiler.js";
import { installStartupUiPatch, setCompactStartupHeader, suppressStartupModelScopeLog } from "./startup-ui.js";
import { installPiTasksWidgetStyling } from "./widgets/pi-tasks-widget.js";

let syncThemeExtrasForCurrentSession: ((force?: boolean) => void) | undefined;
let disposeFixedUserZoneForCurrentSession: (() => void) | undefined;
let restoreTerminalBackgroundForCurrentSession: (() => void) | undefined;
let disposePiTasksWidgetStylingForCurrentSession: (() => void) | undefined;
const FORCE_THEME_SCAN_INTERVAL_MS = 1000;

function isRemoteClipboardSession(env = process.env): boolean {
	// jump's browser terminal receives clipboard writes through OSC 52, but
	// jump sessions are local PTYs, not necessarily SSH/MOSH sessions.
	return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.MOSH_CONNECTION || env.TERM_PROGRAM === "jump");
}

export default function (pi: ExtensionAPI) {
	installCompactToolSpacing();
	installDefaultBadge();
	installQuickEditRenderer(ToolExecutionComponent);
	installMarkdownCodeBlockRenderer();
	installFooterStatsPatch();
	suppressStartupModelScopeLog();
	installStartupUiPatch(InteractiveMode);
	registerToolCallTags(pi);

	let currentThinkingLevel: string | undefined;
	const assistantSpeedTracker = createAssistantSpeedTracker();
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
		assistantSpeedTracker.handleMessageStart(event.message);
		if (event.message.role === "assistant" && runningToolCalls.size === 0) {
			workingLoaderController?.setState(workingStateForAssistantMessage(event.message));
		}
	});

	pi.on("message_update", (event) => {
		assistantSpeedTracker.handleMessageUpdate(event.message);
		if (event.message.role === "assistant" && runningToolCalls.size === 0) {
			workingLoaderController?.setState(workingStateForAssistantMessage(event.message));
		}
	});

	pi.on("thinking_level_select", (event) => {
		currentThinkingLevel = event.level;
	});

	pi.on("message_end", (event) => {
		assistantSpeedTracker.handleMessageEnd(event.message);
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
		profileCount("session.shutdown");
		flushProfile("session_shutdown");
		syncThemeExtrasForCurrentSession = undefined;
		restoreTerminalBackgroundForCurrentSession?.();
		restoreTerminalBackgroundForCurrentSession = undefined;
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
		setAssistantUpdateRenderRequester(undefined);
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

	pi.on("session_start", (_event, ctx) => {
		profileCount("session.start");
		const sessionUi = ctx.ui;
		const sessionCwd = ctx.cwd;
		setAssistantUpdateRenderRequester(undefined);
		setCompactStartupHeader(sessionUi, sessionCwd);
		assistantSpeedTracker.resetSession();
		workingLoaderController?.dispose();
		workingLoaderController = undefined;
		runningToolCalls.clear();
		try {
			currentThinkingLevel = pi.getThinkingLevel();
		} catch (error) {
			if (!isStaleContextError(error)) throw error;
			currentThinkingLevel = undefined;
		}
		const config = loadConfig();
		disposePiTasksWidgetStylingForCurrentSession?.();
		disposePiTasksWidgetStylingForCurrentSession = installPiTasksWidgetStyling(sessionUi);
		restoreTerminalBackgroundForCurrentSession?.();
		restoreTerminalBackgroundForCurrentSession = undefined;
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
		workingLoaderController = createWorkingLoaderController(sessionUi, config.customWorkingMessage);
		workingLoaderController.configure();

		// Treat `alwaysExpanded` as the session-start preference only.
		// Ctrl+o remains authoritative after the session is initialized.
		const initialToolsExpanded = Boolean(config.alwaysExpanded);
		if (sessionUi.getToolsExpanded() !== initialToolsExpanded) {
			sessionUi.setToolsExpanded(initialToolsExpanded);
		}

		// No setTheme() call — use whatever theme is selected in settings
		installAssistantStreamingMarkdownCache(AssistantMessageComponent);
		installAssistantMessagePrefix(sessionUi.theme);
		installUserMessagePrefix(sessionUi.theme);
		installAssistantUpdateDebounce(AssistantMessageComponent);
		installToolExecutionUpdateDebounce(ToolExecutionComponent);
		installFinishedRenderCache(AssistantMessageComponent, ToolExecutionComponent);

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
			setFullTheme(sessionUi.theme, force);
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

		setDefaultBadgeTheme(sessionUi.theme);
		setToolSpacingTheme(sessionUi.theme);

		sessionUi.setEditorComponent((tui, theme, kb) => {
			const uiTheme = (sessionUi.theme ?? theme) as any;
			restoreTerminalBackgroundForCurrentSession?.();
			restoreTerminalBackgroundForCurrentSession = applyTerminalPageBackgroundOsc11(uiTheme, (tui as any).terminal as any, { force: config.forceOSC11 });
			installRenderThrottle(tui as any);
			setAssistantUpdateRenderRequester(() => tui.requestRender());
			virtualizeChatContainer(tui as any);
			installTuiPadding(tui as any);
			installRenderAutowrapGuard(tui as any);
			const piVersion = getPiVersion();
			let fixedZoneSidebarActive = false;
			const fetchBranch = createGitBranchFetcher(sessionCwd, () => tui.requestRender());
			const fixedZoneTheme = createFixedZoneTheme(uiTheme);
			disposeFixedUserZoneForCurrentSession = installFixedUserZone(sessionUi as any, tui as any, {
				enabled: config.fixedUserZone,
				onCopySelection: (text, clipboard) => {
					void copyToClipboard(text).then(
						() => {
							if (isRemoteClipboardSession()) clipboard.emitOsc52Clipboard();
							clipboard.showNotice("success", "Selected text copied to clipboard");
						},
						() => {
							const osc52Emitted = clipboard.emitOsc52Clipboard();
							clipboard.showNotice(osc52Emitted ? "success" : "warning", osc52Emitted ? "Selected text copied to clipboard" : "Copy failed");
						},
					);
				},
				requestScrollRender: () => requestRenderWithFrameMs(tui, FIXED_ZONE_SCROLL_FRAME_MS),
				theme: fixedZoneTheme,
				scrollFrameMs: FIXED_ZONE_SCROLL_FRAME_MS,
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
			installRenderWidthGuard(tui as any);
			installRenderFrameBackground(tui as any, uiTheme);
			installRenderPhysicalSync(tui as any);
			installRenderFrameDebug(tui as any);
			return new BoxEditor(
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
				() => assistantSpeedTracker.getWordsPerSecond(),
				getFooterStatusLine,
				() => fixedZoneSidebarActive ? "sidebar" : "footer",
			);
		});
	});
}
