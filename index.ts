import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AssistantMessageComponent, InteractiveMode, ToolExecutionComponent } from "@mariozechner/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
import { installAssistantUpdateDebounce } from "./debounce-update.js";
import { installToolExecutionUpdateDebounce } from "./debounce-tool-updates.js";
import { loadConfig } from "./config.js";
import { installAssistantMessagePrefix } from "./messages/assistant-prefix.js";
import { installUserMessagePrefix } from "./messages/user-prefix.js";
import { installRenderThrottle } from "./render-throttle.js";
import { getThemeVar, setFullTheme } from "./theme-extras.js";
import { applyTerminalBg, restoreTerminalBg } from "./terminal-bg.js";
import { installCompactToolSpacing, setToolSpacingTheme } from "./tool-tags/compact-tool-spacing.js";
import { installDefaultBadge, setDefaultBadgeTheme } from "./tool-tags/default-badge.js";
import { getRandomWorkingMessage, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./tool-tags/loader-accent.js";
import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installTuiPadding } from "./tui-padding.js";
import { installFooterStatsPatch } from "./footer-patch.js";
import { virtualizeChatContainer } from "./virtualize-chat.js";
import { installStartupUiPatch, setCompactStartupHeader } from "./startup-ui.js";

export default function (pi: ExtensionAPI) {
	installCompactToolSpacing();
	installDefaultBadge();
	installFooterStatsPatch();
	installStartupUiPatch(InteractiveMode);

	let assistantResponseStartMs: number | null = null;
	let currentAssistantTokensPerSecond: number | null = null;
	let lastAssistantTokensPerSecond: number | null = null;
	let lastSpeedUpdateMs = 0;
	const SPEED_UPDATE_INTERVAL_MS = 1000;

	function computeSpeed(outputTokens: number, startMs: number): number {
		const elapsedSeconds = Math.max(0.001, (Date.now() - startMs) / 1000);
		return outputTokens / elapsedSeconds;
	}

	pi.on("message_start", (event) => {
		if (event.message.role !== "assistant") return;
		assistantResponseStartMs = Date.now();
		currentAssistantTokensPerSecond = null;
		lastSpeedUpdateMs = 0;
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		if (!assistantResponseStartMs) return;
		const ae = event.assistantMessageEvent as any;
		if (ae?.type !== "text_delta") return;
		const now = Date.now();
		if (now - lastSpeedUpdateMs < SPEED_UPDATE_INTERVAL_MS) return;
		const outputTokens = ae?.partial?.usage?.output;
		if (typeof outputTokens !== "number" || outputTokens <= 0) return;
		lastSpeedUpdateMs = now;
		const nextSpeed = computeSpeed(outputTokens, assistantResponseStartMs);
		const normalizedSpeed = nextSpeed >= 100 ? Math.round(nextSpeed) : Math.round(nextSpeed * 10) / 10;
		if (currentAssistantTokensPerSecond !== normalizedSpeed) {
			currentAssistantTokensPerSecond = normalizedSpeed;
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const startedAt = assistantResponseStartMs;
		assistantResponseStartMs = null;
		currentAssistantTokensPerSecond = null;
		if (!startedAt) return;
		if (!event.message.content.some((block) => block.type === "text")) return;
		const outputTokens = event.message.usage?.output;
		if (typeof outputTokens !== "number" || outputTokens <= 0) return;
		lastAssistantTokensPerSecond = computeSpeed(outputTokens, startedAt);
	});

	pi.on("session_start", (_event, ctx) => {
		setCompactStartupHeader(ctx.ui, ctx.cwd);
		assistantResponseStartMs = null;
		currentAssistantTokensPerSecond = null;
		lastAssistantTokensPerSecond = null;
		registerToolCallTags(pi);
		const config = loadConfig();
		if (config.customWorkingMessage) {
			const workingMessage = getRandomWorkingMessage() ?? "Working...";
			ctx.ui.setWorkingMessage("");
			ctx.ui.setWorkingIndicator({
				frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg("accent", `${frame} ${workingMessage}`)),
				intervalMs: SPINNER_INTERVAL_MS,
			});
		} else {
			ctx.ui.setWorkingMessage();
			ctx.ui.setWorkingIndicator();
		}

		// Preserve "alwaysExpanded" as initial state only.
		// Let core-driven toggle (Ctrl+o) remain authoritative afterward.
		if (config.alwaysExpanded && !ctx.ui.getToolsExpanded()) {
			ctx.ui.setToolsExpanded(true);
		}

		// No setTheme() call — use whatever theme is selected in settings
		installAssistantMessagePrefix(ctx.ui.theme);
		installUserMessagePrefix(ctx.ui.theme);
		installAssistantUpdateDebounce(AssistantMessageComponent);
		installToolExecutionUpdateDebounce(ToolExecutionComponent);
		setFullTheme(ctx.ui.theme);

		// Apply terminal background and foreground from theme vars
		const bg = getThemeVar("bg");
		const fg = getThemeVar("text");
		if (bg) {
			applyTerminalBg(bg, fg || undefined);
			process.once("exit", restoreTerminalBg);
			process.once("SIGINT", () => { restoreTerminalBg(); process.exit(); });
			process.once("SIGTERM", () => { restoreTerminalBg(); process.exit(); });
		}

		setDefaultBadgeTheme(ctx.ui.theme);
		setToolSpacingTheme(ctx.ui.theme);

		let cachedBranch: { branch: string; insertions?: number; deletions?: number } | null = null;
		let branchLastFetch = 0;
		let branchFetchInFlight = false;
		const fetchBranch = () => {
			const now = Date.now();
			if (branchFetchInFlight || now - branchLastFetch < 5000) return cachedBranch;
			branchFetchInFlight = true;
			branchLastFetch = now;
			const { spawn } = require("child_process");
			const runGit = (args: string[]): Promise<string> =>
				new Promise((resolve) => {
					try {
						const p = spawn("git", args, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "ignore"] });
						let out = "";
						p.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
						p.on("close", (code: number) => resolve(code === 0 ? out.trim() : ""));
						p.on("error", () => resolve(""));
						setTimeout(() => { try { p.kill(); } catch {} }, 1000);
					} catch { resolve(""); }
				});
			(async () => {
				const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
				if (!branch) { cachedBranch = null; branchFetchInFlight = false; return; }
				const stat = await runGit(["diff", "--shortstat"]);
				const insMatch = stat.match(/(\d+) insertion/);
				const delMatch = stat.match(/(\d+) deletion/);
				const insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
				const deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
				cachedBranch = { branch, insertions: insertions || undefined, deletions: deletions || undefined };
				branchFetchInFlight = false;
			})();
			return cachedBranch;
		};

		const isStaleContextError = (error: unknown): boolean =>
			error instanceof Error && error.message.includes("stale after session replacement or reload");

		ctx.ui.setEditorComponent((tui, theme, kb) => {
			installRenderThrottle(tui as any);
			virtualizeChatContainer(tui as any);
			installTuiPadding(tui as any);
			return new BoxEditor(
				tui, theme, kb, ctx.ui.theme ?? theme,
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
						const m = ctx.model;
						if (!m) return undefined;
						return {
							provider: m.provider,
							id: m.id,
							reasoning: m.reasoning,
							thinkingLevel: pi.getThinkingLevel(),
						};
					} catch (error) {
						if (isStaleContextError(error)) return undefined;
						throw error;
					}
				},
				fetchBranch,
				() => currentAssistantTokensPerSecond ?? lastAssistantTokensPerSecond,
			);
		});
	});
}
