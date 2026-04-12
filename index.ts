import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
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

		// No setTheme() call — use whatever theme is selected in settings
		installAssistantMessagePrefix(ctx.ui.theme);
		installUserMessagePrefix(ctx.ui.theme);
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
		const fetchBranch = () => {
			const now = Date.now();
			if (now - branchLastFetch < 5000) return cachedBranch;
			branchLastFetch = now;
			try {
				const { execSync } = require("child_process");
				const opts = { cwd: ctx.cwd, encoding: "utf8" as const, timeout: 1000, stdio: ["ignore", "pipe", "ignore"] as any };
				const branch = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
				if (!branch) { cachedBranch = null; return cachedBranch; }
				let insertions = 0, deletions = 0;
				try {
					const stat = execSync("git diff --shortstat", opts).trim();
					const insMatch = stat.match(/(\d+) insertion/);
					const delMatch = stat.match(/(\d+) deletion/);
					if (insMatch) insertions = parseInt(insMatch[1], 10);
					if (delMatch) deletions = parseInt(delMatch[1], 10);
				} catch {}
				cachedBranch = { branch, insertions: insertions || undefined, deletions: deletions || undefined };
			} catch { cachedBranch = null; }
			return cachedBranch;
		};

		ctx.ui.setEditorComponent((tui, theme, kb) => {
			installRenderThrottle(tui as any);
			virtualizeChatContainer(tui as any);
			installTuiPadding(tui as any);
			return new BoxEditor(
				tui, theme, kb, ctx.ui.theme ?? theme,
				() => ctx.getContextUsage(),
				() => {
					const m = ctx.model;
					if (!m) return undefined;
					return {
						provider: m.provider,
						id: m.id,
						reasoning: m.reasoning,
						thinkingLevel: pi.getThinkingLevel(),
					};
				},
				fetchBranch,
			);
		});
	});
}
