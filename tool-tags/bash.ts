import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { createBashTool, highlightCode } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { loadConfig } from "../config.js";
import { badge, getTextOutput, parens, replaceTabs, isExpanded } from "./common.js";
import { formatElapsed, wrapExecuteWithTiming } from "./elapsed.js";

const MAX_BASH_PREVIEW_LINES = 5;
const MAX_LINE_CHARS = 2000;
const BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;
const BG_ANSI_PATTERN = /\x1b\[4[0-9;]*m/g;

function highlightBashLine(line: string): string {
	try {
		const highlighted = highlightCode(line, "bash")[0] ?? line;
		// Strip background colors to avoid clashing with badge/parens styling
		return highlighted.replace(BG_ANSI_PATTERN, "");
	} catch {
		return line;
	}
}

function clampLineLength(line: string, max: number = MAX_LINE_CHARS): string {
	if (line.length <= max) return line;
	return line.slice(0, max) + "… (truncated)";
}

function countNewlines(text: string, from: number, to: number): number {
	let count = 0;
	for (let i = from; i < to; i++) {
		if (text.charCodeAt(i) === 10) count++;
	}
	return count;
}

function stripBashToolNoticeLines(text: string): string {
	const filteredLines = text
		.replace(/\r/g, "")
		.split("\n")
		.filter((line) => !BASH_TOOL_NOTICE_PATTERN.test(line.trim()));
	return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function createBashResultPreview(
	theme: any,
	text: string,
	options: ToolRenderResultOptions,
	color: "toolOutput" | "error",
	extraLinesBefore: number = 0,
): Component {
	let cacheKey = "";
	let cacheLines: string[] | null = null;

	return {
		invalidate() {
			cacheKey = "";
			cacheLines = null;
		},
		render(width: number): string[] {
			const renderWidth = Math.max(1, width);
			const cfg = loadConfig();
			const expanded = isExpanded(options);
			const cacheId = `${renderWidth}|${expanded ? 1 : 0}|${cfg.maxExpandedLines}|${cfg.dimToolOutput ? 1 : 0}`;
			if (cacheLines && cacheKey === cacheId) return cacheLines;

			if (!expanded) {
				// Collapsed: only process the tail of the output
				// Scan backwards for the last N newlines instead of splitting the entire string
				const needed = MAX_BASH_PREVIEW_LINES;
				let totalNewlines = 0;
				let scanFrom = 0; // default: take full text if fewer than needed newlines
				for (let i = text.length - 1; i >= 0; i--) {
					if (text.charCodeAt(i) === 10) {
						totalNewlines++;
						if (totalNewlines === needed) {
							scanFrom = i + 1;
							break;
						}
					}
				}

				if (text.length === 0) {
					cacheKey = cacheId;
					cacheLines = [];
					return cacheLines;
				}

				const tail = replaceTabs(text.slice(scanFrom)).replace(/\r/g, "");
				const shownLines = tail ? tail.split("\n").map((l) => clampLineLength(l)) : [];

				if (shownLines.length === 0) {
					cacheKey = cacheId;
					cacheLines = [];
					return cacheLines;
				}

				const truncatedShown = shownLines.map((line) => {
					const truncated = truncateToWidth(line, renderWidth, "…");
					if (color === "error") return theme.fg(color, truncated);
					return cfg.dimToolOutput ? theme.fg("toolOutput", truncated) : truncated;
				});

				// Count remaining lines (lines before scanFrom)
				const remaining = extraLinesBefore + (scanFrom > 0 ? countNewlines(text, 0, scanFrom) : 0);

				if (remaining <= 0) {
					cacheKey = cacheId;
					cacheLines = ["", ...truncatedShown];
					return cacheLines;
				}

				const hint = truncateToWidth(`... ${remaining} more lines, press Ctrl+o to expand`, renderWidth, "…");
				cacheKey = cacheId;
				cacheLines = ["", ...truncatedShown, "", theme.fg("muted", hint)];
				return cacheLines;
			}

			// Expanded: process all lines
			const normalized = replaceTabs(text);
			const logicalLines = normalized.split("\n").map((l) => clampLineLength(l));
			const hasOutput = !(logicalLines.length === 1 && logicalLines[0] === "");

			if (!hasOutput) {
				cacheKey = cacheId;
				cacheLines = [];
				return cacheLines;
			}

			const clamped = logicalLines.join("\n");
			const wrapped = wrapTextWithAnsi(clamped, renderWidth);
			const expandedLines = wrapped.length === 1 && wrapped[0] === "" ? [] : wrapped;
			const applyColor = (l: string) => color === "error" ? theme.fg(color, l) : cfg.dimToolOutput ? theme.fg("toolOutput", l) : l;
			if (cfg.maxExpandedLines > 0 && expandedLines.length > cfg.maxExpandedLines) {
				const truncated = expandedLines.slice(-cfg.maxExpandedLines).map(applyColor);
				const remaining = expandedLines.length - cfg.maxExpandedLines;
				truncated.unshift(theme.fg("dim", `… ${remaining} earlier lines`));
				cacheKey = cacheId;
				cacheLines = ["", ...truncated];
				return cacheLines;
			}

			cacheKey = cacheId;
			cacheLines = ["", ...expandedLines.map(applyColor)];
			return cacheLines;
		},
	};
}

export function registerBashTool(pi: ExtensionAPI): void {
	const baseBash = createBashTool(process.cwd());
	pi.registerTool({
		name: baseBash.name,
		label: baseBash.label,
		description: baseBash.description,
		parameters: { ...baseBash.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, onUpdate, ctx) => {
			const tool = createBashTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal, onUpdate);
		}),
		renderCall(args: any, theme: any) {
			const rawCommand = String(args?.command ?? "...");
			const timeout = args?.timeout;
			const timeoutSuffix = timeout ? ` (timeout ${timeout}s)` : "";
			const commandLines = rawCommand.split("\n");
			const maxCommandLines = 5;
			const highlightedFirst = highlightBashLine(commandLines[0]);
			const firstLine = `${badge(theme, "EXECUTE")} ${parens(theme, highlightedFirst + (commandLines.length === 1 ? timeoutSuffix : ""), true)}`;			return {
				invalidate() {},
				render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					const lines = [...wrapTextWithAnsi(firstLine, renderWidth)];
					const showCount = Math.min(commandLines.length, maxCommandLines + 1);
					for (let i = 1; i < showCount; i++) {
						const highlighted = highlightBashLine(commandLines[i]);
						const wrapped = wrapTextWithAnsi(highlighted, renderWidth);
						lines.push(...wrapped);
					}
					if (commandLines.length > maxCommandLines + 1) {
						lines.push(theme.fg("muted", `... ${commandLines.length - maxCommandLines - 1} more lines`));
					}
					if (commandLines.length > 1 && timeoutSuffix) {
						lines.push(theme.fg("muted", timeoutSuffix.trim()));
					}
					return lines;
				},
			};
		},
		renderResult(result, options, theme: any, context: any) {
			const raw = getTextOutput(result);
			const outputColor = context?.isError ? "error" : "toolOutput";
			const elapsed = formatElapsed(result);
			const elapsedSuffix = elapsed ? theme.italic(theme.fg("muted", elapsed)) : "";

			if (!isExpanded(options)) {
				const scanLines = MAX_BASH_PREVIEW_LINES + 10;
				let nlCount = 0;
				let tailStart = 0;
				for (let i = raw.length - 1; i >= 0; i--) {
					if (raw.charCodeAt(i) === 10) {
						nlCount++;
						if (nlCount >= scanLines) {
							tailStart = i + 1;
							break;
						}
					}
				}
				const tail = stripBashToolNoticeLines(stripAnsi(raw.slice(tailStart)));
				const totalLinesBefore = tailStart > 0 ? countNewlines(raw, 0, tailStart) : 0;
				const inner = createBashResultPreview(theme, tail, options, outputColor, totalLinesBefore);
				if (!elapsedSuffix) return inner;
				return {
					invalidate() { inner.invalidate(); },
					render(width: number): string[] {
						const lines = [...inner.render(width)];
						if (lines.length > 0) {
							lines[lines.length - 1] += ` ${theme.fg("dim", "–")} ${elapsedSuffix}`;
						} else {
							lines.push(elapsedSuffix);
						}
						return lines;
					},
				};
			}
			const output = stripBashToolNoticeLines(stripAnsi(raw));
			const inner = createBashResultPreview(theme, output, options, outputColor, 0);
			if (!elapsedSuffix) return inner;
			return {
				invalidate() { inner.invalidate(); },
				render(width: number): string[] {
					const lines = [...inner.render(width)];
					if (lines.length > 0) {
						lines[lines.length - 1] += ` ${theme.fg("dim", "–")} ${elapsedSuffix}`;
					} else {
						lines.push(elapsedSuffix);
					}
					return lines;
				},
			};
		},
	});
}
