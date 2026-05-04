import type { AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import { fgHex } from "../ansi.js";
import { loadConfig } from "../config.js";
import { getThemeExtra } from "../theme-extras.js";
import { formatElapsed } from "./elapsed.js";

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

export function renderToolCallHeader(theme: any, label: string, detail: string, skipTextColor?: boolean): Component {
	return renderToolCallHeaderLines(theme, label, [parens(theme, detail, skipTextColor)]);
}

export function renderToolCallHeaderLines(theme: any, label: string, detailLines: string[]): Component {
	const prefix = `${badge(theme, label)} `;
	const indent = " ".repeat(visibleWidth(prefix));
	return {
		invalidate() {},
		render(width: number): string[] {
			const bodyWidth = Math.max(1, width - visibleWidth(prefix));
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

export function indentToolBody(text: string, spaces = 2): string {
	const indent = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => (line.length === 0 ? line : `${indent}${line}`))
		.join("\n");
}

export function indentToolBodyLines(lines: string[], spaces = 2): string[] {
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
	cfg: { maxLines: number; tail?: boolean; color?: "toolOutput" | "error" } = { maxLines: 10 },
): string {
	const color = cfg.color ?? "toolOutput";
	const rawLines = (text ?? "").split("\n").map(clampLine);
	const lines = rawLines.length === 1 && rawLines[0] === "" ? [] : rawLines;

	if (lines.length === 0) {
		return "";
	}

	if (isExpanded(options) || lines.length <= cfg.maxLines) {
		return lines.map((line) => theme.fg(color, line)).join("\n");
	}

	const shown = cfg.tail ? lines.slice(-cfg.maxLines) : lines.slice(0, cfg.maxLines);
	const remaining = lines.length - shown.length;

	let output = shown.map((line) => theme.fg(color, line)).join("\n");
	output += theme.fg("muted", `\n\n... ${remaining} more lines, press Ctrl+o to expand`);

	return output;
}

export function dimWithElapsed(theme: any, summary: string, result: AgentToolResult<any> | undefined): string {
	const elapsed = formatElapsed(result);
	return elapsed
		? `${theme.fg("dim", summary)} ${theme.fg("dim", "–")} ${theme.italic(theme.fg("muted", elapsed))}`
		: theme.fg("dim", summary);
}
