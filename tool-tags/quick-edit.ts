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
import { getTextOutput, isExpanded, renderToolCallHeader, renderToolMetricsFooter, resolveRelativePath } from "./common.js";
import { formatToolMetricsFromValues } from "./elapsed.js";

const RESULT_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.result.patched");
const CALL_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.call.patched");
const STARTED_AT_KEY = "__droidStartedAt";
const ELAPSED_MS_KEY = "__droidElapsedMs";
const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type QuickEditToolConfig = {
	headerLabel: string;
	applyingLabel: string;
	fallbackLabel: string;
};

const QUICK_EDIT_TOOLS: Record<string, QuickEditToolConfig> = {
	quick_edit: {
		headerLabel: "QUICK EDIT",
		applyingLabel: "quick-edit",
		fallbackLabel: "Quick edit applied",
	},
	structured_edit: {
		headerLabel: "STRUCTURED EDIT",
		applyingLabel: "structured-edit",
		fallbackLabel: "Structured edit applied",
	},
};

function getQuickEditToolConfig(toolName: unknown): QuickEditToolConfig | undefined {
	return typeof toolName === "string" ? QUICK_EDIT_TOOLS[toolName] : undefined;
}

type QuickEditRenderContext = {
	args?: any;
	isError?: boolean;
	state?: Record<string, any>;
	executionStarted?: boolean;
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

function renderQuickEditCall(args: any, theme: any, config: QuickEditToolConfig, context: QuickEditRenderContext = {}) {
	if (context.executionStarted && typeof context.state === "object" && typeof context.state[STARTED_AT_KEY] !== "number") {
		context.state[STARTED_AT_KEY] = performance.now();
	}
	const rawPath = String(args?.path ?? "");
	const relPath = rawPath ? resolveRelativePath(rawPath, process.cwd()) : "";
	const detail = relPath || "(unknown)";
	return renderToolCallHeader(theme, config.headerLabel, detail);
}

function getQuickEditMetrics(output: string, context: QuickEditRenderContext): string {
	const state = context.state;
	let elapsedMs: number | undefined;
	if (state && typeof state === "object") {
		if (typeof state[ELAPSED_MS_KEY] !== "number" && typeof state[STARTED_AT_KEY] === "number") {
			state[ELAPSED_MS_KEY] = performance.now() - state[STARTED_AT_KEY];
		}
		if (typeof state[ELAPSED_MS_KEY] === "number") elapsedMs = state[ELAPSED_MS_KEY];
	}
	return formatToolMetricsFromValues(elapsedMs, output.length);
}

function renderQuickEditResult(
	result: any,
	options: ToolRenderResultOptions,
	theme: any,
	config: QuickEditToolConfig,
	context: QuickEditRenderContext = {},
) {
	if (options.isPartial) {
		return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", `Applying ${config.applyingLabel}...`)}`, 0, 0);
	}

	const output = getTextOutput(result);
	if (context.isError || result?.isError) {
		return new Text(`${theme.fg("error", stripAnsi(output).trim() || "Error")}`, 0, 0);
	}

	const diff = extractQuickEditDiff(output);
	if (!diff) {
		const fallback = stripAnsi(output).trim() || config.fallbackLabel;
		const metrics = getQuickEditMetrics(output, context);
		const suffix = metrics ? ` ${theme.fg("dim", "–")} ${theme.italic(theme.fg("muted", metrics))}` : "";
		return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", fallback)}${suffix}`, 0, 0);
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
	const metrics = getQuickEditMetrics(output, context);
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
			return [...headerLines, ...split.render(safeWidth), ...renderToolMetricsFooter(theme, safeWidth, metrics)];
		},
		invalidate(): void {
			split.invalidate();
		},
	};
}

export function installQuickEditRenderer(ToolExecutionComponentClass: any): void {
	const proto = ToolExecutionComponentClass?.prototype;
	if (!proto) return;

	if (!proto[RESULT_PATCHED] && typeof proto.getResultRenderer === "function") {
		proto[RESULT_PATCHED] = true;
		const baseGetResultRenderer = proto.getResultRenderer;
		proto.getResultRenderer = function patchedQuickEditResultRenderer(this: any, ...args: any[]) {
			const config = getQuickEditToolConfig(this.toolName);
			if (config) return (result: any, options: ToolRenderResultOptions, theme: any, context: QuickEditRenderContext = {}) =>
				renderQuickEditResult(result, options, theme, config, context);
			return baseGetResultRenderer.apply(this, args);
		};
	}

	if (!proto[CALL_PATCHED] && typeof proto.getCallRenderer === "function") {
		proto[CALL_PATCHED] = true;
		const baseGetCallRenderer = proto.getCallRenderer;
		proto.getCallRenderer = function patchedQuickEditCallRenderer(this: any, ...args: any[]) {
			const config = getQuickEditToolConfig(this.toolName);
			if (config) return (args: any, theme: any, context: QuickEditRenderContext = {}) => renderQuickEditCall(args, theme, config, context);
			return baseGetCallRenderer.apply(this, args);
		};
	}
}
