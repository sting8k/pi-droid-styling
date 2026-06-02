import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, copyToClipboard, InteractiveMode, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
import { installFixedUserZone } from "./fixed-zone/install.js";
import { createAssistantSpeedTracker } from "./core/assistant-speed.js";
import { createGitBranchFetcher } from "./core/git-status.js";
import { getPiVersion } from "./core/pi-version.js";
import { readSessionMetadata } from "./core/session-metadata.js";
import { installAssistantUpdateDebounce } from "./performance/debounce-update.js";
import { installToolExecutionUpdateDebounce } from "./performance/debounce-tool-updates.js";
import { loadConfig } from "./config.js";
import { installAssistantMessagePrefix } from "./messages/assistant-prefix.js";
import { installAssistantStreamingMarkdownCache } from "./messages/streaming-markdown-cache.js";
import { installUserMessagePrefix } from "./messages/user-prefix.js";
import { installRenderThrottle } from "./performance/render-throttle.js";
import { getThemeVar, setFullTheme } from "./theme/theme-extras.js";
import { applyTerminalBg, restoreTerminalBg } from "./theme/terminal-bg.js";
import { installCompactToolSpacing, setToolSpacingTheme } from "./tool-tags/compact-tool-spacing.js";
import { installDefaultBadge, setDefaultBadgeTheme } from "./tool-tags/default-badge.js";
import { installQuickEditRenderer } from "./tool-tags/quick-edit.js";
import { getRandomWorkingMessage, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./tool-tags/loader-accent.js";
import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installTuiPadding } from "./tui-padding.js";
import { getFooterStatusLine, installFooterStatsPatch } from "./footer-patch.js";
import { virtualizeChatContainer } from "./performance/virtualize-chat.js";
import { flushProfile, profileCount } from "./performance/profiler.js";
import { installStartupUiPatch, setCompactStartupHeader, suppressStartupModelScopeLog } from "./startup-ui.js";

let syncTerminalThemeForCurrentSession: ((force?: boolean) => void) | undefined;
let disposeFixedUserZoneForCurrentSession: (() => void) | undefined;
let terminalSignalHandlersInstalled = false;
const FORCE_THEME_SCAN_INTERVAL_MS = 1000;

export default function (pi: ExtensionAPI) {
	installCompactToolSpacing();
	installDefaultBadge();
	installQuickEditRenderer(ToolExecutionComponent);
	installFooterStatsPatch();
	suppressStartupModelScopeLog();
	installStartupUiPatch(InteractiveMode);
	registerToolCallTags(pi);

	let currentThinkingLevel: string | undefined;
	const assistantSpeedTracker = createAssistantSpeedTracker();

	const isStaleContextError = (error: unknown): boolean =>
		error instanceof Error && error.message.includes("stale after session replacement or reload");

	pi.on("message_start", (event) => {
		assistantSpeedTracker.handleMessageStart(event.message);
	});

	pi.on("message_update", (event) => {
		assistantSpeedTracker.handleMessageUpdate(event.message);
	});

	pi.on("thinking_level_select", (event) => {
		currentThinkingLevel = event.level;
	});

	pi.on("message_end", (event) => {
		assistantSpeedTracker.handleMessageEnd(event.message);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		profileCount("session.shutdown");
		flushProfile("session_shutdown");
		syncTerminalThemeForCurrentSession = undefined;
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
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
		setCompactStartupHeader(sessionUi, sessionCwd);
		assistantSpeedTracker.resetSession();
		try {
			currentThinkingLevel = pi.getThinkingLevel();
		} catch (error) {
			if (!isStaleContextError(error)) throw error;
			currentThinkingLevel = undefined;
		}
		const config = loadConfig();
		disposeFixedUserZoneForCurrentSession?.();
		disposeFixedUserZoneForCurrentSession = undefined;
		if (config.customWorkingMessage) {
			const workingMessage = getRandomWorkingMessage() ?? "Working...";
			sessionUi.setWorkingMessage("");
			sessionUi.setWorkingIndicator({
				frames: SPINNER_FRAMES.map((frame) => sessionUi.theme.fg("accent", `${frame} ${workingMessage}`)),
				intervalMs: SPINNER_INTERVAL_MS,
			});
		} else {
			sessionUi.setWorkingMessage();
			sessionUi.setWorkingIndicator();
		}

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

		let lastTerminalBg = "";
		let lastTerminalFg = "";
		let lastForcedThemeScanAt = 0;
		const syncTerminalTheme = (force = false) => {
			if (force) {
				const now = Date.now();
				if (lastForcedThemeScanAt > 0 && now - lastForcedThemeScanAt < FORCE_THEME_SCAN_INTERVAL_MS) {
					force = false;
				} else {
					lastForcedThemeScanAt = now;
				}
			}
			setFullTheme(sessionUi.theme, force);
			const bg = getThemeVar("bg");
			const fg = getThemeVar("text");
			if (!bg || (bg === lastTerminalBg && fg === lastTerminalFg)) return;
			lastTerminalBg = bg;
			lastTerminalFg = fg;
			applyTerminalBg(bg, fg || undefined);
		};
		syncTerminalThemeForCurrentSession = syncTerminalTheme;
		syncTerminalTheme(true);
		if (!terminalSignalHandlersInstalled) {
			terminalSignalHandlersInstalled = true;
			process.once("exit", restoreTerminalBg);
			process.once("SIGINT", () => { restoreTerminalBg(); process.exit(); });
			process.once("SIGTERM", () => { restoreTerminalBg(); process.exit(); });
		}

		const interactiveModePrototype = InteractiveMode.prototype as any;
		const originalUpdateEditorBorderColor = interactiveModePrototype.updateEditorBorderColor;
		if (typeof originalUpdateEditorBorderColor === "function" && !originalUpdateEditorBorderColor.__droidTerminalThemeSync) {
			const wrappedUpdateEditorBorderColor = function (this: any, ...args: any[]) {
				syncTerminalThemeForCurrentSession?.(true);
				return originalUpdateEditorBorderColor.apply(this, args);
			};
			(wrappedUpdateEditorBorderColor as any).__droidTerminalThemeSync = true;
			interactiveModePrototype.updateEditorBorderColor = wrappedUpdateEditorBorderColor;
		}

		setDefaultBadgeTheme(sessionUi.theme);
		setToolSpacingTheme(sessionUi.theme);

		sessionUi.setEditorComponent((tui, theme, kb) => {
			installRenderThrottle(tui as any);
			virtualizeChatContainer(tui as any);
			installTuiPadding(tui as any);
			const piVersion = getPiVersion();
			let fixedZoneSidebarActive = false;
			const fetchBranch = createGitBranchFetcher(sessionCwd, () => tui.requestRender());
			disposeFixedUserZoneForCurrentSession = installFixedUserZone(sessionUi as any, tui as any, {
				enabled: config.fixedUserZone,
				onCopySelection: copyToClipboard,
				sidebar: {
					enabled: config.fixedUserZoneSidebar,
					theme: {
						fg: (color: string, text: string) => {
							try {
								return typeof sessionUi.theme?.fg === "function" ? sessionUi.theme.fg(color as any, text) : text;
							} catch {
								return text;
							}
						},
					},
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
			return new BoxEditor(
				tui, theme, kb, sessionUi.theme ?? theme, sessionCwd,
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
