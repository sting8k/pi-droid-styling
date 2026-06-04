import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import { DEFAULT_COLLAPSED_RENDER_LINES, boxedResultRenderBudget, clampRenderLine, fastBoxLineContent, safeWrapTextWithAnsi, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { profileCount } from "../performance/profiler.js";
import { RESET_BACKGROUND, bgHexAnsi, fgHex, isHexColor, stripAnsi, wrapAnsiBackground } from "../theme/ansi.js";
import { getThemeExtra, getThemeVarBackground } from "../theme/theme-extras.js";
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
	// Include hyphen and apostrophe for natural language, underscore for code.
	// Avoid String.match() here: it allocates one entry per word on large tool outputs.
	let count = 0;
	let inWord = false;
	for (const char of text) {
		const isWord = /[\p{L}\p{N}_'-]/u.test(char);
		if (isWord && !inWord) count++;
		inWord = isWord;
	}
	return count;
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
const COMPACT_TOOL_NAME_WIDTH = safeVisibleWidth("Search");
const COMPACT_FOOTER_ELAPSED_WIDTH = 8;
const COMPACT_FOOTER_EXTRA_WIDTH = 8;
const COMPACT_FOOTER_WORDS_WIDTH = safeVisibleWidth("✎ ~1.2k words");

export function boxWidth(width: number): number {
	return Math.max(BOX_MIN_WIDTH, width);
}

export function boxInnerWidth(width: number): number {
	return Math.max(1, boxWidth(width) - 2 - BOX_SIDE_PADDING * 2);
}

function tightBoxWidth(availableWidth: number, contentLines: string[], labelWidths: number[] = [], widthKey?: string): number {
	const contentWidth = contentLines.reduce((max, line) => Math.max(max, safeVisibleWidth(line)), 0);
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

function themeBg(theme: any, bgName: string, text: string): string {
	// Try vars first (e.g., toolSuccessBg in theme vars)
	const varBg = getThemeVarBackground(theme, bgName);
	if (varBg) {
		const bgAnsi = bgHexAnsi(theme, varBg);
		if (bgAnsi) return wrapAnsiBackground(text, bgAnsi);
	}

	// Try theme.getBgAnsi (export tokens like pageBg/cardBg/infoBg)
	try {
		if (typeof theme?.getBgAnsi === "function") {
			const bgAnsi = String(theme.getBgAnsi(bgName) ?? "");
			if (bgAnsi && bgAnsi !== RESET_BACKGROUND) return wrapAnsiBackground(text, bgAnsi);
		}
	} catch {}

	// Fallback to theme.bg
	try {
		return typeof theme?.bg === "function" ? theme.bg(bgName, text) : text;
	} catch {
		return text;
	}
}

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

export function boxBg(theme: any, text: string, bgName = "toolSuccessBg"): string {
	return themeBg(theme, bgName, text);
}

function boxBgLines(theme: any, lines: string[], bgName = "toolSuccessBg"): string[] {
	return lines.map((line) => boxBg(theme, line, bgName));
}

export function boxBorder(theme: any, left: string, right: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const innerWidth = renderedWidth - 2;
	return boxFrameText(theme, `${left}${BOX_HORIZONTAL.repeat(innerWidth)}${right}`);
}

function padVisibleRight(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - safeVisibleWidth(text)))}`;
}

function boxLineWithRight(theme: any, left: string, right: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const contentWidth = boxInnerWidth(renderedWidth);
	const divider = ` ${boxText(theme, "|")} `;
	const dividerWidth = safeVisibleWidth(divider);
	const rightWidth = safeVisibleWidth(right);
	const sidePad = " ".repeat(BOX_SIDE_PADDING);

	if (!right || rightWidth + dividerWidth >= contentWidth) {
		return boxLine(theme, right || left, renderedWidth);
	}

	const maxLeftWidth = Math.max(1, contentWidth - dividerWidth - rightWidth - 1);
	const truncatedLeft = safeTruncateToWidth(left, maxLeftWidth, "…");
	const gap = " ".repeat(Math.max(1, contentWidth - safeVisibleWidth(truncatedLeft) - dividerWidth - rightWidth));
	return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${truncatedLeft}${gap}${divider}${right}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}

export function boxLine(theme: any, content: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const contentWidth = boxInnerWidth(renderedWidth);
	const fastContent = fastBoxLineContent(content, contentWidth);
	const sidePad = " ".repeat(BOX_SIDE_PADDING);
	if (fastContent) {
		const counter = fastContent.kind === "ascii"
			? "boxLine.fastAscii"
			: fastContent.kind === "sgrAscii"
				? "boxLine.fastSgrAscii"
				: fastContent.kind === "simple"
					? "boxLine.fastSimple"
					: "boxLine.fastSgrSimple";
		profileCount(counter);
		const fill = " ".repeat(Math.max(0, contentWidth - fastContent.visibleWidth));
		return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${fastContent.text}${fill}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
	}

	profileCount("boxLine.fallback");
	const truncated = safeTruncateToWidth(content, contentWidth, "…");
	const fill = " ".repeat(Math.max(0, contentWidth - safeVisibleWidth(truncated)));
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

function boxedTruncatedLine(theme: any, content: string, width: number): string {
	return boxLine(theme, safeTruncateToWidth(content, boxInnerWidth(width), "…"), width);
}

type RenderLinesCache = {
	width: number;
	lines: string[];
};

function pushBoundedLines(target: string[], lines: string[], maxLines: number): boolean {
	const slots = maxLines - target.length;
	if (slots <= 0) return false;
	if (lines.length > slots) {
		target.push(...lines.slice(0, slots));
		return false;
	}
	target.push(...lines);
	return true;
}

function renderBoxedOutputLines(theme: any, outputLines: string[], width: number, rawLineBudget = DEFAULT_COLLAPSED_RENDER_LINES): string[] {
	const budget = boxedResultRenderBudget(rawLineBudget);
	const headLimit = Math.max(0, Math.min(budget.headLines, budget.maxRenderedLines));
	const tailLimit = Math.max(0, Math.min(budget.tailLines, Math.max(0, budget.maxRenderedLines - headLimit - 1)));
	const head: string[] = [];
	let nextInputIndex = 0;
	let truncated = false;

	for (; nextInputIndex < outputLines.length; nextInputIndex++) {
		const line = boxedTruncatedLine(theme, outputLines[nextInputIndex] ?? "", width);
		if (!pushBoundedLines(head, [line], headLimit)) {
			truncated = true;
			nextInputIndex++;
			break;
		}
	}

	if (!truncated && nextInputIndex >= outputLines.length) return head;

	const tail: string[] = [];
	const tailStart = Math.max(nextInputIndex, outputLines.length - tailLimit);
	for (let i = tailStart; i < outputLines.length; i++) {
		const line = boxedTruncatedLine(theme, outputLines[i] ?? "", width);
		tail.push(line);
		if (tail.length > tailLimit) tail.splice(0, tail.length - tailLimit);
	}

	const skippedInputLines = Math.max(0, tailStart - nextInputIndex);
	const skippedText = skippedInputLines > 0
		? `… rendered output truncated; ${skippedInputLines} input lines skipped before tail`
		: "… rendered output truncated";
	return [...head, boxLine(theme, theme.fg("muted", skippedText), width), ...tail];
}
export function renderBoxedToolCall(
	theme: any,
	toolName: string,
	detailLines: string[],
	options: { widthKey?: string; isError?: boolean; isPartial?: boolean; isPending?: boolean; pendingText?: string } = {},
): Component {
	let cache: RenderLinesCache | null = null;
	return {
		invalidate() { cache = null; },
		render(width: number): string[] {
			if (cache?.width === width) return cache.lines;
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
			cache = { width, lines: rendered };
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
	options: { outputLabel?: string; footerLines?: string[]; emptyText?: string; widthKey?: string; referenceLines?: string[]; renderLineBudget?: number; isError?: boolean; isPartial?: boolean } = {},
): Component {
	let cache: RenderLinesCache | null = null;
	return {
		invalidate() {
			cache = null;
			if (typeof body !== "function") body.invalidate();
		},
		render(width: number): string[] {
			if (cache?.width === width) return cache.lines;
			const renderedWidth = boxWidth(width);
			const maxContentWidth = boxInnerWidth(renderedWidth);
			const bodyLines = typeof body === "function" ? body(maxContentWidth) : body.render(maxContentWidth);
			const errorPrefix = options.isError ? [theme.fg("error", "✗ Error")] : [];
			const outputLines = bodyLines.length > 0 ? [...errorPrefix, ...bodyLines] : [theme.fg("muted", `∅ ${options.emptyText ?? "(no output)"}`)];
			const footerLines = options.footerLines ?? [];
			const renderedFooterLines = footerLines.length > 0
				? [boxInsetDivider(theme, renderedWidth), ...footerLines.map((line) => boxLine(theme, line, renderedWidth))]
				: [];
			const rendered = boxBgLines(theme, [
				boxInsetDivider(theme, renderedWidth),
				...renderBoxedOutputLines(theme, outputLines, renderedWidth, options.renderLineBudget ?? outputLines.length),
				...renderedFooterLines,
				boxBorder(theme, "└", "┘", renderedWidth),
			], boxedToolBgName(options.isError, options.isPartial));
			cache = { width, lines: rendered };
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
	const indent = " ".repeat(safeVisibleWidth(prefix));
	return {
		invalidate() {},
		render(width: number): string[] {
			const bodyWidth = Math.max(1, width - safeVisibleWidth(prefix) - TOOL_RIGHT_MARGIN);
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

function selectRenderLines(text: string, maxLines: number, tail = false): { lines: string[]; omitted: number } {
	const source = text ?? "";
	if (!source) return { lines: [], omitted: 0 };
	const limit = Math.max(0, maxLines);
	const selected: string[] = [];
	let lineCount = 0;
	let lineStart = 0;

	for (let i = 0; i <= source.length; i++) {
		if (i < source.length && source[i] !== "\n") continue;
		const rawLine = source.slice(lineStart, i).replace(/\r/g, "");
		lineCount++;
		if (limit > 0) {
			const line = clampLine(rawLine);
			if (tail) {
				selected.push(line);
				if (selected.length > limit) selected.shift();
			} else if (selected.length < limit) {
				selected.push(line);
			}
		}
		lineStart = i + 1;
	}

	if (selected.length === 1 && selected[0] === "") return { lines: [], omitted: 0 };
	return { lines: selected, omitted: Math.max(0, lineCount - selected.length) };
}

export function renderLines(
	theme: any,
	text: string,
	options: ToolRenderResultOptions,
	cfg: { maxLines: number; tail?: boolean; color?: "toolOutput" | "error"; width?: number } = { maxLines: 10 },
): string {
	const color = cfg.color ?? "toolOutput";
	const { lines, omitted } = selectRenderLines(text, cfg.maxLines, cfg.tail);
	const renderWidth = cfg.width ? getToolBodyWidth(cfg.width) : undefined;
	const renderLine = (line: string) => {
		const rendered = renderWidth ? safeTruncateToWidth(line, renderWidth, "…") : line;
		return formatToolOutputLine(theme, rendered, color);
	};

	if (lines.length === 0) return "";

	let output = lines.map(renderLine).join("\n");
	if (omitted <= 0) return output;

	const hintText = isExpanded(options)
		? `... ${omitted} more lines omitted by render budget`
		: `... ${omitted} more lines, press Ctrl+o to expand`;
	const hint = cfg.width
		? safeTruncateToWidth(hintText, Math.max(1, cfg.width - 1), "…")
		: hintText;
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
