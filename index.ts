import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AssistantMessageComponent } from "@mariozechner/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
import { installAssistantUpdateDebounce } from "./debounce-update.js";
import { loadConfig } from "./config.js";
import { installAssistantMessagePrefix } from "./messages/assistant-prefix.js";
import { installUserMessagePrefix } from "./messages/user-prefix.js";
import { installRenderThrottle } from "./render-throttle.js";
import { getThemeVar, setFullTheme } from "./theme-extras.js";
import { applyTerminalBg, restoreTerminalBg } from "./terminal-bg.js";
import { installCompactToolSpacing, setToolSpacingTheme } from "./tool-tags/compact-tool-spacing.js";
import { installDefaultBadge, setDefaultBadgeTheme } from "./tool-tags/default-badge.js";
import { installLoaderAccent } from "./tool-tags/loader-accent.js";
import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installTuiPadding } from "./tui-padding.js";
import { installFooterStatsPatch } from "./footer-patch.js";
import { virtualizeChatContainer } from "./virtualize-chat.js";

export default function (pi: ExtensionAPI) {
	installCompactToolSpacing();
	installDefaultBadge();
	installLoaderAccent();
	installFooterStatsPatch();

	pi.on("session_start", (_event, ctx) => {
		registerToolCallTags(pi);

		// Preserve "alwaysExpanded" as initial state only.
		// Let core-driven toggle (Ctrl+o) remain authoritative afterward.
		if (loadConfig().alwaysExpanded && !ctx.ui.getToolsExpanded()) {
			ctx.ui.setToolsExpanded(true);
		}

		// No setTheme() call — use whatever theme is selected in settings
		installAssistantMessagePrefix(ctx.ui.theme);
		installUserMessagePrefix(ctx.ui.theme);
		installAssistantUpdateDebounce(AssistantMessageComponent);
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
			);
		});
	});
}
