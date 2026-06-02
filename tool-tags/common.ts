import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import { BOXED_RESULT_RENDERED_HEAD_LINES, BOXED_RESULT_RENDERED_TAIL_LINES, clampRenderLine, clampRenderedLines, safeWrapTextWithAnsi } from "../render-budget.js";
import { fgHex, isHexColor, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";
import { formatToolMetrics, getElapsedMs } from "./elapsed.js";

export function isExpanded(options: ToolRenderResultOptions): boolean {
	return typeof options?.expanded === "boolean" ? options.expanded : false;
}

export function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

export function resolveAbsolutePath(rawPath: string, cwd: string): string {
	const path = rawPath.trim();
	if (!path) return "";

	const home = process.env.HOME;
	if (home && (path === "~" || path.startsWith("~/"))) {
		return path === "~" ? home : resolve(home, path.slice(2));
	}

	return resolve(cwd, path);
}

export function resolveRelativePath(rawPath: string, cwd: string): string {
	const absPath = resolveAbsolutePath(rawPath, cwd);
	if (!absPath) return "(unknown)";
	const relPath = relative(cwd, absPath).replace(/\\/g, "/");
	return relPath || ".";
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function getTextOutput(result: AgentToolResult<any> | undefined): string {
	if (!result?.content) return "";
	const textBlocks = result.content.filter((contentBlock: any) => contentBlock.type === "text");
	return textBlocks.map((contentBlock: any) => String(contentBlock.text ?? "")).join("\n").replace(/\r/g, "");
}

export function stripTrailingNotice(text: string): string {
	const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
	if (!normalized) return "";
	if (normalized.startsWith("[") && normalized.endsWith("]")) return "";
	const noticeStart = normalized.lastIndexOf("\n\n[");
	if (noticeStart >= 0 && normalized.endsWith("]")) {
		return normalized.slice(0, noticeStart).trimEnd();
	}
	return normalized;
}

export function extractTrailingNotice(text: string): string | null {
	const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
	if (!normalized) return null;
	if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized;
	const noticeStart = normalized.lastIndexOf("\n\n[");
	if (noticeStart >= 0 && normalized.endsWith("]")) {
		return normalized.slice(noticeStart + 2).trimEnd();
	}
	return null;
}

export function countLines(text: string): number {
	const normalized = (text ?? "").replace(/\r/g, "").replace(/\n+$/g, "");
	if (!normalized) return 0;
	return normalized.split("\n").length;
}

export function countWords(text: string): number {
	// Include hyphen and apostrophe for natural language, underscore for code
	return text.match(/[\p{L}\p{N}_'-]+/gu)?.length ?? 0;
}

function formatCompactCount(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
	return `${Math.round(value / 1000000)}M`;
}

export function formatBoxedWords(text: string): string {
	return `✎ ~${formatCompactCount(countWords(text))} words`;
}

export function badge(theme: any, label: string): string {
	const tagBg = getThemeExtra(theme, "tagBgColor");
	return theme.inverse(fgHex(theme, tagBg, theme.bold(` ${label} `)));
}

export function parens(theme: any, text: string, skipTextColor?: boolean): string {
	const bracketColor = getThemeExtra(theme, "parensBracketColor");
	const openParen = bracketColor ? fgHex(theme, bracketColor, "(") : "(";
	const closeParen = bracketColor ? fgHex(theme, bracketColor, ")") : ")";
	// Tool-call parameter text is bold; if a custom parens text color is set,
	// apply that first and then wrap with bold so output styling stays unchanged.
	let innerBase: string;
	if (skipTextColor) {
		// When text already has ANSI styling (e.g. syntax-highlighted), skip parensTextColor
		innerBase = text;
	} else {
		const textColor = getThemeExtra(theme, "parensTextColor");
		innerBase = textColor ? fgHex(theme, textColor, text) : text;
	}
	const inner = typeof theme?.bold === "function" ? theme.bold(innerBase) : `\x1b[1m${innerBase}\x1b[22m`;
	return `${openParen}${inner}${closeParen}`;
}

const BOX_HORIZONTAL = "─";
const BOX_VERTICAL = "│";
const BOX_SIDE_PADDING = 2;
const BOX_MIN_WIDTH = 12;
const BOX_WIDTH_CACHE = new Map<string, number>();
const COMPACT_TOOL_NAME_WIDTH = visibleWidth("Search");
const COMPACT_FOOTER_ELAPSED_WIDTH = 8;
const COMPACT_FOOTER_EXTRA_WIDTH = 8;
const COMPACT_FOOTER_WORDS_WIDTH = visibleWidth("✎ ~1.2k words");

export function boxWidth(width: number): number {
	return Math.max(BOX_MIN_WIDTH, width);
}

export function boxInnerWidth(width: number): number {
	return Math.max(1, boxWidth(width) - 2 - BOX_SIDE_PADDING * 2);
}

function tightBoxWidth(availableWidth: number, contentLines: string[], labelWidths: number[] = [], widthKey?: string): number {
	const contentWidth = contentLines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	const labelWidth = labelWidths.reduce((max, width) => Math.max(max, width), 0);
	const neededWidth = Math.max(BOX_MIN_WIDTH, contentWidth + 2 + BOX_SIDE_PADDING * 2, labelWidth + 2 + BOX_SIDE_PADDING * 2);
	const measuredWidth = Math.min(boxWidth(availableWidth), neededWidth);
	if (!widthKey) return measuredWidth;
	const cachedWidth = BOX_WIDTH_CACHE.get(widthKey) ?? 0;
	const nextWidth = Math.min(boxWidth(availableWidth), Math.max(cachedWidth, measuredWidth));
	BOX_WIDTH_CACHE.set(widthKey, nextWidth);
	return nextWidth;
}

export function boxedToolWidthKey(toolName: string, detail: string): string {
	return `${toolName}:${detail}`;
}

export function formatToolName(toolName: string): string {
	const spaced = toolName
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.trim();
	return spaced.replace(/\b\w/g, (char) => char.toUpperCase()) || toolName;
}

function formatToolParamName(name: string): string {
	const spaced = name
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.trim();
	return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : name;
}

const MAX_PARAM_VALUE_LENGTH = 120;

function formatOperationSummary(value: unknown): string | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	if (!value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return undefined;
	const types = Array.from(new Set(value.map((item: any) => String(item.type ?? "operation"))));
	const typeSummary = types.length === 1 ? ` (${types[0]})` : types.length > 1 ? ` (${types.slice(0, 3).join(", ")}${types.length > 3 ? ", …" : ""})` : "";
	return `${value.length} ${value.length === 1 ? "operation" : "operations"}${typeSummary}`;
}

function formatToolParamValue(value: unknown): string {
	if (value === undefined) return "";
	if (value === null) return "null";
	if (typeof value === "string") {
		if (value.length <= MAX_PARAM_VALUE_LENGTH) return value;
		return value.slice(0, MAX_PARAM_VALUE_LENGTH) + "…";
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		return formatOperationSummary(value) ?? `${value.length} ${value.length === 1 ? "item" : "items"}`;
	}
	if (typeof value === "object" && value !== null) {
		const keys = Object.keys(value);
		if (keys.length === 0) return "{}";
		return `{${keys.length} ${keys.length === 1 ? "key" : "keys"}}`;
	}
	try {
		const json = JSON.stringify(value);
		if (json.length <= MAX_PARAM_VALUE_LENGTH) return json;
		return json.slice(0, MAX_PARAM_VALUE_LENGTH) + "…";
	} catch {
		return String(value);
	}
}

export function formatToolParamLines(args: unknown, theme?: any): string[] {
	if (args === undefined || args === null) return [];
	if (typeof args !== "object" || Array.isArray(args)) {
		const value = formatToolParamValue(args);
		return value ? [`Params: ${value}`] : [];
	}

	const entries = Object.entries(args as Record<string, unknown>).filter(([, value]) => value !== undefined);
	if (entries.length === 0) return [];

	const lines: string[] = [];
	for (const [key, value] of entries) {
		const formattedValue = formatToolParamValue(value);
		if (!formattedValue) continue;
		const [firstLine = "", ...restLines] = formattedValue.replace(/\r/g, "").split("\n");
		const keyLabel = formatToolParamName(key);
		if (theme) {
			lines.push(`${theme.fg("dim", keyLabel + ":")} ${theme.fg("text", firstLine)}`);
			lines.push(...restLines.map((line) => `  ${theme.fg("text", line)}`));
		} else {
			lines.push(`${keyLabel}: ${firstLine}`);
			lines.push(...restLines.map((line) => `  ${line}`));
		}
	}
	return lines;
}

const RESET_INTENSITY = "\x1b[22m";

function colorFromExtra(theme: any, extraKey: string, fallbackColor: string, text: string): string {
	const color = getThemeExtra(theme, extraKey);
	if (color) {
		if (isHexColor(color)) return fgHex(theme, color, text);
		try {
			return typeof theme?.fg === "function" ? theme.fg(color, text) : text;
		} catch {
			// Fall back to semantic theme color below.
		}
	}
	return typeof theme?.fg === "function" ? theme.fg(fallbackColor, text) : text;
}

export function formatBoxedToolTitle(theme: any, name: string, isError?: boolean): string {
	const icon = isError ? "✗" : "✓";
	const rawTitle = `➔ ${name} ${icon}`;
	const coloredTitle = colorFromExtra(theme, "bashPromptColor", "bashMode", rawTitle);
	const title = typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
	return `${title} ${boxText(theme, "|")}`;
}

function formatCompactBoxedToolTitle(theme: any, name: string, isError?: boolean): string {
	const icon = isError ? "✗" : "✓";
	const paddedName = padVisibleRight(name, COMPACT_TOOL_NAME_WIDTH);
	const rawTitle = `➔ ${paddedName} ${icon}`;
	const coloredTitle = colorFromExtra(theme, "bashPromptColor", "bashMode", rawTitle);
	const title = typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
	return `${title} ${boxText(theme, "|")}`;
}

function boxText(theme: any, text: string): string {
	return `${RESET_INTENSITY}${theme.fg("borderMuted", text)}`;
}
function boxFrameText(theme: any, text: string): string {
	return `${RESET_INTENSITY}${theme.fg("border", text)}`;
}

export function boxedToolBgName(isError?: boolean, isPartial?: boolean): string {
	return isPartial ? "toolPendingBg" : isError ? "toolErrorBg" : "toolSuccessBg";
}

export function boxBg(_theme: any, text: string, _bgName = "toolSuccessBg"): string {
	return text;
}

function boxBgLines(_theme: any, lines: string[], _bgName?: string): string[] {
	return lines;
}

export function boxBorder(theme: any, left: string, right: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const innerWidth = renderedWidth - 2;
	return boxFrameText(theme, `${left}${BOX_HORIZONTAL.repeat(innerWidth)}${right}`);
}

function padVisibleRight(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function boxLineWithRight(theme: any, left: string, right: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const contentWidth = boxInnerWidth(renderedWidth);
	const divider = ` ${boxText(theme, "|")} `;
	const dividerWidth = visibleWidth(divider);
	const rightWidth = visibleWidth(right);
	const sidePad = " ".repeat(BOX_SIDE_PADDING);

	if (!right || rightWidth + dividerWidth >= contentWidth) {
		return boxLine(theme, right || left, renderedWidth);
	}

	const maxLeftWidth = Math.max(1, contentWidth - dividerWidth - rightWidth - 1);
	const truncatedLeft = truncateToWidth(left, maxLeftWidth, "…");
	const gap = " ".repeat(Math.max(1, contentWidth - visibleWidth(truncatedLeft) - dividerWidth - rightWidth));
	return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${truncatedLeft}${gap}${divider}${right}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}

export function boxLine(theme: any, content: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const contentWidth = boxInnerWidth(renderedWidth);
	const truncated = truncateToWidth(content, contentWidth, "…");
	const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(truncated)));
	const sidePad = " ".repeat(BOX_SIDE_PADDING);
	return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${truncated}${fill}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}

function boxInsetDivider(theme: any, width: number): string {
	const renderedWidth = boxWidth(width);
	const lineWidth = boxInnerWidth(renderedWidth);
	const sidePad = " ".repeat(BOX_SIDE_PADDING);
	return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${boxText(theme, BOX_HORIZONTAL.repeat(lineWidth))}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}

export function boxedWrappedLines(theme: any, content: string, width: number): string[] {
	return safeWrapTextWithAnsi(content, boxInnerWidth(width)).map((line) => boxLine(theme, line, width));
}
export function renderBoxedToolCall(
	theme: any,
	toolName: string,
	detailLines: string[],
	options: { widthKey?: string; isError?: boolean; isPartial?: boolean; isPending?: boolean; pendingText?: string } = {},
): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const title = formatBoxedToolTitle(theme, toolName, options.isError);
			const renderedWidth = boxWidth(width);
			const lines = [
				boxBorder(theme, "┌", "┐", renderedWidth),
				boxLine(theme, title, renderedWidth),
				boxInsetDivider(theme, renderedWidth),
				...detailLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
			];
			if (options.isPending) {
				const pendingText = options.pendingText ?? "Waiting for output…";
				lines.push(
					boxInsetDivider(theme, renderedWidth),
					...boxedWrappedLines(theme, `${theme.fg("muted", "…")} ${theme.fg("dim", pendingText)}`, renderedWidth),
					boxBorder(theme, "└", "┘", renderedWidth),
				);
			}
			const rendered = boxBgLines(theme, lines, boxedToolBgName(options.isError, options.isPartial));
			return rendered;
		}
	};
}

const COMPACT_FOOTER_KEY = "__droidCompactFooter";
const COMPACT_FOOTER_ERROR_KEY = "__droidCompactFooterError";
const COMPACT_FOOTER_PARTIAL_KEY = "__droidCompactFooterPartial";

export function clearCompactBoxedFooter(state: any): void {
	if (!state || typeof state !== "object") return;
	delete state[COMPACT_FOOTER_KEY];
	delete state[COMPACT_FOOTER_ERROR_KEY];
	delete state[COMPACT_FOOTER_PARTIAL_KEY];
}

export function renderCompactBoxedToolCall(
	theme: any,
	toolName: string,
	detailLine: string,
	options: { widthKey?: string; state?: any; isError?: boolean; isPartial?: boolean; isPending?: boolean; pendingText?: string } = {},
): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const renderedWidth = boxWidth(width);
			const title = `${formatCompactBoxedToolTitle(theme, toolName, options.isError)} ${detailLine}`;
			const compactFooter = typeof options.state?.[COMPACT_FOOTER_KEY] === "string" ? options.state[COMPACT_FOOTER_KEY] : "";
			const footerIsError = Boolean(options.state?.[COMPACT_FOOTER_ERROR_KEY]);
			const footerIsPartial = Boolean(options.state?.[COMPACT_FOOTER_PARTIAL_KEY]);
			if (compactFooter) {
				return boxBgLines(theme, [
					boxBorder(theme, "┌", "┐", renderedWidth),
					boxLineWithRight(theme, title, compactFooter, renderedWidth),
					boxBorder(theme, "└", "┘", renderedWidth),
				], boxedToolBgName(footerIsError || options.isError, footerIsPartial || options.isPartial));
			}

			const lines = [boxBorder(theme, "┌", "┐", renderedWidth), boxLine(theme, title, renderedWidth)];
			if (options.isPending) {
				const pendingText = options.pendingText ?? "Waiting for output…";
				lines.push(
					boxInsetDivider(theme, renderedWidth),
					...boxedWrappedLines(theme, `${theme.fg("muted", "…")} ${theme.fg("dim", pendingText)}`, renderedWidth),
					boxBorder(theme, "└", "┘", renderedWidth),
				);
			}
			return boxBgLines(theme, lines, boxedToolBgName(options.isError, options.isPartial));
		}
	};
}

type BoxedResultBody = Component | ((contentWidth: number) => string[]);

export function renderBoxedToolResult(
	theme: any,
	body: BoxedResultBody,
	options: { outputLabel?: string; footerLines?: string[]; emptyText?: string; widthKey?: string; referenceLines?: string[]; isError?: boolean; isPartial?: boolean } = {},
): Component {
	return {
		invalidate() {
			if (typeof body !== "function") body.invalidate();
		},
		render(width: number): string[] {
			const renderedWidth = boxWidth(width);
			const maxContentWidth = boxInnerWidth(renderedWidth);
			const bodyLines = typeof body === "function" ? body(maxContentWidth) : body.render(maxContentWidth);
			const errorPrefix = options.isError ? [theme.fg("error", "✗ Error")] : [];
			const outputLines = bodyLines.length > 0 ? [...errorPrefix, ...bodyLines] : [theme.fg("muted", `∅ ${options.emptyText ?? "(no output)"}`)];
			const footerLines = options.footerLines ?? [];
			const renderedFooterLines = footerLines.length > 0
				? [boxInsetDivider(theme, renderedWidth), ...footerLines.map((line) => boxLine(theme, line, renderedWidth))]
				: [];
			const wrappedOutputLines = outputLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth));
			const boundedOutputLines = clampRenderedLines(
				wrappedOutputLines,
				BOXED_RESULT_RENDERED_HEAD_LINES,
				BOXED_RESULT_RENDERED_TAIL_LINES,
				(remaining) => boxLine(theme, theme.fg("muted", `… ${remaining} more rendered lines omitted`), renderedWidth),
			);
			const rendered = boxBgLines(theme, [
				boxInsetDivider(theme, renderedWidth),
				...boundedOutputLines,
				...renderedFooterLines,
				boxBorder(theme, "└", "┘", renderedWidth),
			], boxedToolBgName(options.isError, options.isPartial));
			return rendered;
		},
	};
}

export function formatBoxedWallTime(result: AgentToolResult<any> | undefined): string {
	const elapsedMs = getElapsedMs(result);
	if (elapsedMs === undefined) return "--";
	return `${(elapsedMs / 1000).toFixed(2)}s`;
}

function formatBoxedFooterParts(theme: any, result: AgentToolResult<any> | undefined, extraParts: string[] = [], fixedColumns = false): string {
	const elapsedPart = `${theme.fg("text", "◷")} ${theme.fg("dim", formatBoxedWallTime(result))}`;
	const extraPartList = extraParts.filter(Boolean).map((part) => theme.fg("dim", part));
	const wordsPart = theme.fg("dim", formatBoxedWords(getTextOutput(result)));
	const parts = fixedColumns
		? [
			padVisibleRight(elapsedPart, COMPACT_FOOTER_ELAPSED_WIDTH),
			...extraPartList.map((part) => padVisibleRight(part, COMPACT_FOOTER_EXTRA_WIDTH)),
			padVisibleRight(wordsPart, COMPACT_FOOTER_WORDS_WIDTH),
		]
		: [elapsedPart, ...extraPartList, wordsPart];
	return parts.join(theme.fg("dim", " · "));
}

export function formatBoxedFooter(theme: any, result: AgentToolResult<any> | undefined, extraParts: string[] = []): string {
	return formatBoxedFooterParts(theme, result, extraParts);
}

export function renderCompactBoxedFooter(theme: any, result: AgentToolResult<any> | undefined, options: { state?: any; isError?: boolean; isPartial?: boolean } = {}): Component {
	if (options.state && typeof options.state === "object") {
		options.state[COMPACT_FOOTER_KEY] = formatBoxedFooterParts(theme, result, [], true);
		options.state[COMPACT_FOOTER_ERROR_KEY] = Boolean(options.isError);
		options.state[COMPACT_FOOTER_PARTIAL_KEY] = Boolean(options.isPartial);
		return { invalidate() {}, render: () => [] };
	}

	return {
		invalidate() {},
		render(width: number): string[] {
			const renderedWidth = boxWidth(width);
			return boxBgLines(theme, [
				boxLine(theme, formatBoxedFooterParts(theme, result), renderedWidth),
				boxBorder(theme, "└", "┘", renderedWidth),
			], boxedToolBgName(options.isError, options.isPartial));
		},
	};
}

const TOOL_BODY_INDENT = 2;
const TOOL_RIGHT_MARGIN = 1;

export function renderToolCallHeader(theme: any, label: string, detail: string, skipTextColor?: boolean): Component {
	return renderToolCallHeaderLines(theme, label, [parens(theme, detail, skipTextColor)]);
}

export function getToolBodyWidth(width: number, spaces = TOOL_BODY_INDENT): number {
	return Math.max(1, width - spaces - TOOL_RIGHT_MARGIN);
}

export function renderToolCallHeaderLines(theme: any, label: string, detailLines: string[]): Component {
	const prefix = `${badge(theme, label)} `;
	const indent = " ".repeat(visibleWidth(prefix));
	return {
		invalidate() {},
		render(width: number): string[] {
			const bodyWidth = Math.max(1, width - visibleWidth(prefix) - TOOL_RIGHT_MARGIN);
			const output: string[] = [];
			for (let i = 0; i < detailLines.length; i++) {
				const wrapped = safeWrapTextWithAnsi(detailLines[i] ?? "", bodyWidth);
				if (i === 0) {
					output.push(`${prefix}${wrapped[0] ?? ""}`);
					output.push(...wrapped.slice(1).map((line) => `${indent}${line}`));
				} else {
					output.push(...wrapped.map((line) => `${indent}${line}`));
				}
			}
			return output.length > 0 ? output : [prefix.trimEnd()];
		},
	};
}

export function indentToolBody(text: string, spaces = TOOL_BODY_INDENT): string {
	const indent = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => (line.length === 0 ? line : `${indent}${line}`))
		.join("\n");
}

export function indentToolBodyLines(lines: string[], spaces = TOOL_BODY_INDENT): string[] {
	const indent = " ".repeat(spaces);
	return lines.map((line) => (line.length === 0 ? line : `${indent}${line}`));
}

function clampLine(line: string): string {
	return clampRenderLine(line);
}

export function formatToolOutputLine(theme: any, line: string, color: "toolOutput" | "error" | "text" = "toolOutput"): string {
	if (color === "error") return theme.fg("error", line);

	const clean = stripAnsi(line);
	if (/^##\s/.test(clean)) return theme.fg("muted", line);
	if (/^\?\?\s/.test(clean)) return theme.bold(theme.fg("syntaxVariable", line));

	return theme.fg(color, line);
}

export function renderLines(
	theme: any,
	text: string,
	options: ToolRenderResultOptions,
	cfg: { maxLines: number; tail?: boolean; color?: "toolOutput" | "error"; width?: number } = { maxLines: 10 },
): string {
	const color = cfg.color ?? "toolOutput";
	const rawLines = (text ?? "").split("\n").map(clampLine);
	const lines = rawLines.length === 1 && rawLines[0] === "" ? [] : rawLines;
	const renderWidth = cfg.width ? getToolBodyWidth(cfg.width) : undefined;
	const renderLine = (line: string) => {
		const rendered = renderWidth ? truncateToWidth(line, renderWidth, "…") : line;
		return formatToolOutputLine(theme, rendered, color);
	};

	if (lines.length === 0) {
		return "";
	}

	if (isExpanded(options) || lines.length <= cfg.maxLines) {
		return lines.map(renderLine).join("\n");
	}

	const shown = cfg.tail ? lines.slice(-cfg.maxLines) : lines.slice(0, cfg.maxLines);
	const remaining = lines.length - shown.length;

	let output = shown.map(renderLine).join("\n");
	const hint = cfg.width
		? truncateToWidth(`... ${remaining} more lines, press Ctrl+o to expand`, Math.max(1, cfg.width - 1), "…")
		: `... ${remaining} more lines, press Ctrl+o to expand`;
	output += theme.fg("muted", `\n\n${hint}`);

	return output;
}

export function dimWithElapsed(theme: any, summary: string, result: AgentToolResult<any> | undefined): string {
	const metrics = formatToolMetrics(result);
	return metrics
		? `${theme.fg("dim", summary)} ${theme.fg("dim", "–")} ${theme.italic(theme.fg("muted", metrics))}`
		: theme.fg("dim", summary);
}

export function renderToolMetricsFooter(theme: any, _width: number, metrics: string): string[] {
	return metrics ? [theme.italic(theme.fg("muted", `↳ ${metrics}`))] : [];
}
