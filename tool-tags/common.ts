import type { AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import { fgHex } from "../ansi.js";
import { loadConfig } from "../config.js";
import { getThemeExtra } from "../theme-extras.js";
import { formatToolMetrics, getElapsedMs } from "./elapsed.js";

export function isExpanded(options: ToolRenderResultOptions): boolean {
	if (typeof options?.expanded === "boolean") return options.expanded;
	return loadConfig().alwaysExpanded;
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
	return `Words: ~${formatCompactCount(countWords(text))}w`;
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
const BOX_MIN_WIDTH = 12;
const BOX_WIDTH_CACHE = new Map<string, number>();

export function boxWidth(width: number): number {
	return Math.max(BOX_MIN_WIDTH, width);
}

export function boxInnerWidth(width: number): number {
	return Math.max(1, boxWidth(width) - 4);
}

function tightBoxWidth(availableWidth: number, contentLines: string[], labelWidths: number[] = [], widthKey?: string): number {
	const contentWidth = contentLines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	const labelWidth = labelWidths.reduce((max, width) => Math.max(max, width), 0);
	const neededWidth = Math.max(BOX_MIN_WIDTH, contentWidth + 4, labelWidth);
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

export function formatBoxedToolTitle(theme: any, name: string, isError?: boolean): string {
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
	return `${icon} ${theme.bold(theme.fg("accent", name))}`;
}

export function boxBorder(theme: any, left: string, right: string, width: number, label?: string): string {
	const renderedWidth = boxWidth(width);
	const innerWidth = renderedWidth - 2;
	if (!label) return theme.fg("text", `${left}${BOX_HORIZONTAL.repeat(innerWidth)}${right}`);

	const before = `${BOX_HORIZONTAL} `;
	const afterPrefix = " ";
	const afterWidth = Math.max(0, innerWidth - visibleWidth(before) - visibleWidth(label) - visibleWidth(afterPrefix));
	return `${theme.fg("text", `${left}${before}`)}${label}${theme.fg("text", `${afterPrefix}${BOX_HORIZONTAL.repeat(afterWidth)}${right}`)}`;
}

export function boxLine(theme: any, content: string, width: number): string {
	const renderedWidth = boxWidth(width);
	const innerWidth = boxInnerWidth(renderedWidth);
	const truncated = truncateToWidth(content, innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
	return `${theme.fg("text", "│")} ${truncated}${padding} ${theme.fg("text", "│")}`;
}

export function boxedWrappedLines(theme: any, content: string, width: number): string[] {
	return wrapTextWithAnsi(content, boxInnerWidth(width)).map((line) => boxLine(theme, line, width));
}

export function renderBoxedToolCall(theme: any, toolName: string, detailLines: string[], options: { widthKey?: string; isError?: boolean } = {}): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const title = formatBoxedToolTitle(theme, toolName, options.isError);
			const renderedWidth = boxWidth(width);
			return [
				boxBorder(theme, "┌", "┐", renderedWidth, title),
				...detailLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
			];
		},
	};
}

type BoxedResultBody = Component | ((contentWidth: number) => string[]);

export function renderBoxedToolResult(
	theme: any,
	body: BoxedResultBody,
	options: { outputLabel?: string; footerLines?: string[]; emptyText?: string; widthKey?: string; referenceLines?: string[]; isError?: boolean } = {},
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
			const outputLabel = options.outputLabel ?? "";
			const separatorLabel = outputLabel || undefined;
			return [
				boxBorder(theme, "├", "┤", renderedWidth, separatorLabel),
				...outputLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
				...footerLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
				boxBorder(theme, "└", "┘", renderedWidth),
			];
		},
	};
}

export function formatBoxedWallTime(result: AgentToolResult<any> | undefined): string {
	const elapsedMs = getElapsedMs(result);
	if (elapsedMs === undefined) return "--";
	return `${(elapsedMs / 1000).toFixed(2)}s`;
}

export function formatBoxedFooter(theme: any, result: AgentToolResult<any> | undefined, extraParts: string[] = []): string {
	const parts = [`Wall: ${formatBoxedWallTime(result)}`, ...extraParts.filter(Boolean), formatBoxedWords(getTextOutput(result))];
	return theme.fg("dim", `[${parts.join(" | ")}]`);
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
				const wrapped = wrapTextWithAnsi(detailLines[i] ?? "", bodyWidth);
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

const MAX_RENDER_LINE_CHARS = 2000;

function clampLine(line: string): string {
	if (line.length <= MAX_RENDER_LINE_CHARS) return line;
	return line.slice(0, MAX_RENDER_LINE_CHARS) + "… (truncated)";
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
		return theme.fg(color, rendered);
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
