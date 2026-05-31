import type { ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { getLanguageFromPath } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../theme/ansi.js";
import {
	SplitDiffComponent,
	buildSplitRows,
	countDiffStats,
	renderDiffMeter,
} from "../split-diff.js";
import { formatBoxedWords, getTextOutput, isExpanded, renderBoxedToolCall, renderBoxedToolResult, resolveRelativePath } from "./common.js";

const RESULT_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.result.patched");
const CALL_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.call.patched");
const STARTED_AT_KEY = "__droidStartedAt";
const ELAPSED_MS_KEY = "__droidElapsedMs";
const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type QuickEditToolConfig = {
	toolLabel: string;
	applyingLabel: string;
	fallbackLabel: string;
};

const QUICK_EDIT_TOOLS: Record<string, QuickEditToolConfig> = {
	quick_edit: {
		toolLabel: "Quick Edit",
		applyingLabel: "quick-edit",
		fallbackLabel: "Quick edit applied",
	},
	substitute_edit: {
		toolLabel: "Substitute Edit",
		applyingLabel: "substitute-edit",
		fallbackLabel: "Substitute edit applied",
	},
	target_edit: {
		toolLabel: "Target Edit",
		applyingLabel: "target-edit",
		fallbackLabel: "Target edit applied",
	},
};

function getQuickEditToolConfig(toolName: unknown): QuickEditToolConfig | undefined {
	return typeof toolName === "string" ? QUICK_EDIT_TOOLS[toolName] : undefined;
}

type QuickEditRenderContext = {
	args?: any;
	isError?: boolean;
	isPartial?: boolean;
	hasResult?: boolean;
	state?: Record<string, any>;
	executionStarted?: boolean;
};

function extractQuickEditDiff(text: string): string | undefined {
	const lines = stripAnsi(text).replace(/\r/g, "").split("\n");
	const start = lines.indexOf("── diff ──");
	if (start < 0) return undefined;

	const diffLines: string[] = [];
	let cumulativeDelta = 0;
	let oldLine: number | undefined;
	let newLine: number | undefined;
	let chunkAdditions = 0;
	let chunkRemovals = 0;

	const finishChunk = () => {
		cumulativeDelta += chunkAdditions - chunkRemovals;
		oldLine = undefined;
		newLine = undefined;
		chunkAdditions = 0;
		chunkRemovals = 0;
	};

	for (const line of lines.slice(start + 1)) {
		if (line === "") {
			finishChunk();
			continue;
		}

		const headerMatch = line.match(/^:(\d+)(?:-\d+)?$/);
		if (headerMatch) {
			finishChunk();
			const startLine = Number.parseInt(headerMatch[1] ?? "", 10);
			oldLine = startLine;
			newLine = startLine + cumulativeDelta;
			continue;
		}

		const match = line.match(/^([+-]) (.*)$/);
		if (match) {
			const [, sign, content = ""] = match;
			let gutter = "";
			if (sign === "-" && oldLine !== undefined) gutter = String(oldLine++);
			if (sign === "+" && newLine !== undefined) gutter = String(newLine++);
			if (!gutter) continue;
			if (sign === "-") chunkRemovals++;
			if (sign === "+") chunkAdditions++;
			diffLines.push(`${sign} ${gutter} ${content}`);
			continue;
		}

		if (line === "---") break;
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
	return renderBoxedToolCall(theme, config.toolLabel, [`${theme.fg("dim", "Path: ")}${detail}`], {
		isError: Boolean(context.isError),
		isPartial: Boolean(context.isPartial),
		isPending: Boolean(context.isPartial && !context.hasResult),
	});
}

function getQuickEditElapsedMs(context: QuickEditRenderContext): number | undefined {
	const state = context.state;
	if (!state || typeof state !== "object") return undefined;
	if (typeof state[ELAPSED_MS_KEY] !== "number" && typeof state[STARTED_AT_KEY] === "number") {
		state[ELAPSED_MS_KEY] = performance.now() - state[STARTED_AT_KEY];
	}
	return typeof state[ELAPSED_MS_KEY] === "number" ? state[ELAPSED_MS_KEY] : undefined;
}

function formatQuickEditFooter(theme: any, context: QuickEditRenderContext, output = ""): string {
	const elapsedMs = getQuickEditElapsedMs(context);
	const wall = elapsedMs === undefined ? "--" : `${(elapsedMs / 1000).toFixed(2)}s`;
	return theme.fg("toolOutput", `[◷ ${wall} · ${formatBoxedWords(output)}]`);
}

function renderQuickEditResult(
	result: any,
	options: ToolRenderResultOptions,
	theme: any,
	config: QuickEditToolConfig,
	context: QuickEditRenderContext = {},
) {
	if (options.isPartial) {
		return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "↳")} ${theme.fg("muted", `Applying ${config.applyingLabel}...`)}`], { isPartial: true });
	}

	const output = getTextOutput(result);
	if (context.isError || result?.isError) {
		return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
			footerLines: [formatQuickEditFooter(theme, context, output)],
			isError: true,
		});
	}

	const diff = extractQuickEditDiff(output);
	if (!diff) {
		const fallback = stripAnsi(output).trim() || config.fallbackLabel;
		return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "↳")} ${theme.fg("muted", fallback)}`], {
			footerLines: [formatQuickEditFooter(theme, context, output)],
		});
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

	return renderBoxedToolResult(theme, {
		render(width: number): string[] {
			const safeWidth = Math.max(20, width);
			const headerLines = new Text(summary, 0, 0).render(safeWidth);
			return [...headerLines, ...split.render(safeWidth)];
		},
		invalidate(): void {
			split.invalidate();
		},
	}, {
		footerLines: [formatQuickEditFooter(theme, context, output)],
	});
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
