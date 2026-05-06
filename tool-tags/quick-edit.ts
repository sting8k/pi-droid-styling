import type { ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { getLanguageFromPath } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import {
	SplitDiffComponent,
	buildSplitRows,
	countDiffStats,
	renderDiffMeter,
} from "../split-diff.js";
import { getTextOutput, isExpanded } from "./common.js";

const PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.patched");
const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type QuickEditRenderContext = {
	args?: any;
	isError?: boolean;
};

function extractQuickEditDiff(text: string): string | undefined {
	const lines = stripAnsi(text).replace(/\r/g, "").split("\n");
	const start = lines.indexOf("── diff ──");
	if (start < 0) return undefined;

	const diffLines: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line === "" || /^:\d+(?:-\d+)?$/.test(line)) continue;

		const match = line.match(/^([+-]) (\d+):[0-9a-f]{3}\|(.*)$/);
		if (match) {
			const [, sign, lineNo, content = ""] = match;
			diffLines.push(`${sign} ${lineNo} ${content}`);
			continue;
		}

		// Context output starts after the compact diff block.
		if (/^\d+:[0-9a-f]{3}\|/.test(line) || line === "---") break;
	}

	return diffLines.length > 0 ? diffLines.join("\n") : undefined;
}

function renderQuickEditResult(result: any, options: ToolRenderResultOptions, theme: any, context: QuickEditRenderContext = {}) {
	if (options.isPartial) {
		return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", "Applying quick-edit...")}`, 0, 0);
	}

	const output = getTextOutput(result);
	if (context.isError || result?.isError) {
		return new Text(`${theme.fg("error", stripAnsi(output).trim() || "Error")}`, 0, 0);
	}

	const diff = extractQuickEditDiff(output);
	if (!diff) {
		const fallback = stripAnsi(output).trim() || "Quick edit applied";
		return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", fallback)}`, 0, 0);
	}

	const rows = buildSplitRows(diff);
	const expanded = isExpanded(options);
	const argPath = String(context?.args?.path ?? "");
	const language = argPath ? getLanguageFromPath(argPath) : undefined;
	const shouldHighlight =
		Boolean(language) &&
		diff.length <= MAX_HIGHLIGHT_DIFF_CHARS &&
		rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;

	const { additions, removals } = countDiffStats(diff);
	const meter = renderDiffMeter(theme, additions, removals);
	const summary =
		`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
		` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
		` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
		` ${theme.fg("muted", "split")}` +
		(meter ? ` ${meter}` : "");

	const maxRows = expanded ? 160 : 36;
	const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : undefined);

	return {
		render(width: number): string[] {
			const safeWidth = Math.max(20, width - 1);
			const headerLines = new Text(summary, 0, 0).render(safeWidth);
			return [...headerLines, ...split.render(safeWidth)];
		},
		invalidate(): void {
			split.invalidate();
		},
	};
}

export function installQuickEditRenderer(ToolExecutionComponentClass: any): void {
	const proto = ToolExecutionComponentClass?.prototype;
	if (!proto || proto[PATCHED]) return;
	if (typeof proto.getResultRenderer !== "function") return;
	proto[PATCHED] = true;

	const baseGetResultRenderer = proto.getResultRenderer;
	proto.getResultRenderer = function patchedQuickEditResultRenderer(this: any, ...args: any[]) {
		if (this.toolName === "quick_edit") return renderQuickEditResult;
		return baseGetResultRenderer.apply(this, args);
	};
}
