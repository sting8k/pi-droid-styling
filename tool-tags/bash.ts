import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { createBashTool, highlightCode } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { loadConfig } from "../config.js";
import { getTextOutput, getToolBodyWidth, indentToolBodyLines, isExpanded, parens, renderToolCallHeaderLines, replaceTabs } from "./common.js";
import { formatElapsed, wrapExecuteWithTiming } from "./elapsed.js";

const MAX_BASH_PREVIEW_LINES = 5;
const MAX_LINE_CHARS = 2000;
const BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;
const BG_ANSI_PATTERN = /\x1b\[4[0-9;]*m/g;
const SHELL_VAR_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
const SHELL_OP_PATTERN = /^(?:&&|\|\||>>|>&|\|&|[|&;()<>])$/;

function highlightBashFallback(line: string): string {
	try {
		const highlighted = highlightCode(line, "bash")[0] ?? line;
		// Strip background colors to avoid clashing with badge/parens styling
		return highlighted.replace(BG_ANSI_PATTERN, "");
	} catch {
		return line;
	}
}

function normalizeShellWord(word: string): string {
	return word.replace(/^(['"])(.*)\1$/, "$2");
}

function colorShellWord(theme: any, word: string, commandExpected: boolean): string {
	const normalized = normalizeShellWord(word);
	if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalized)) return theme.fg("syntaxVariable", word);
	if (normalized.startsWith("-")) return theme.fg("syntaxKeyword", word);
	if (normalized.includes("/") || /^\.{1,2}(?:\/|$)/.test(normalized)) return theme.fg("syntaxVariable", word);
	if (SHELL_VAR_PATTERN.test(normalized)) return theme.fg("syntaxVariable", word);
	return commandExpected ? theme.fg("syntaxFunction", word) : theme.fg("syntaxString", word);
}

function tokenizeShellLinePreservingText(line: string): string[] | undefined {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;

	for (let i = 0; i < line.length; i++) {
		const char = line[i] ?? "";
		const next = line[i + 1] ?? "";

		if (quote) {
			current += char;
			if (char === "\\" && next) current += line[++i] ?? "";
			else if (char === quote) quote = null;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			tokens.push(char);
			continue;
		}

		if (char === "#" && !current) {
			if (current) tokens.push(current);
			tokens.push(line.slice(i));
			return tokens;
		}

		const two = `${char}${next}`;
		if (SHELL_OP_PATTERN.test(two) || SHELL_OP_PATTERN.test(char)) {
			if (current) tokens.push(current);
			current = "";
			if (SHELL_OP_PATTERN.test(two)) {
				tokens.push(two);
				i++;
			} else {
				tokens.push(char);
			}
			continue;
		}

		current += char;
	}

	if (quote) return undefined;
	if (current) tokens.push(current);
	return tokens;
}

function highlightBashLine(line: string, theme: any): string {
	const tokens = tokenizeShellLinePreservingText(line);
	if (!tokens) return highlightBashFallback(line);
	let commandExpected = true;
	return tokens
		.map((token) => {
			if (/^\s+$/.test(token)) return token;
			if (token.startsWith("#")) return theme.fg("syntaxComment", token);
			if (SHELL_OP_PATTERN.test(token)) {
				commandExpected = token === "|" || token === "||" || token === "&&" || token === ";" || token === "&";
				return theme.fg("syntaxOperator", token);
			}
			const styled = colorShellWord(theme, token, commandExpected);
			if (!/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalizeShellWord(token))) commandExpected = false;
			return styled;
		})
		.join("");
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
			const bodyWidth = getToolBodyWidth(renderWidth);
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
					const truncated = truncateToWidth(line, bodyWidth, "…");
					if (color === "error") return theme.fg(color, truncated);
					return cfg.dimToolOutput ? theme.fg("toolOutput", truncated) : truncated;
				});

				// Count remaining lines (lines before scanFrom)
				const remaining = extraLinesBefore + (scanFrom > 0 ? countNewlines(text, 0, scanFrom) : 0);

				if (remaining <= 0) {
					cacheKey = cacheId;
					cacheLines = ["", ...indentToolBodyLines(truncatedShown)];
					return cacheLines;
				}

				const hint = truncateToWidth(`... ${remaining} more lines, press Ctrl+o to expand`, renderWidth - 1, "…");
				cacheKey = cacheId;
				cacheLines = ["", ...indentToolBodyLines(truncatedShown), "", theme.fg("muted", hint)];
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
			const wrapped = wrapTextWithAnsi(clamped, bodyWidth);
			const expandedLines = wrapped.length === 1 && wrapped[0] === "" ? [] : wrapped;
			const applyColor = (l: string) => color === "error" ? theme.fg(color, l) : cfg.dimToolOutput ? theme.fg("toolOutput", l) : l;
			if (cfg.maxExpandedLines > 0 && expandedLines.length > cfg.maxExpandedLines) {
				const truncated = expandedLines.slice(-cfg.maxExpandedLines).map(applyColor);
				const remaining = expandedLines.length - cfg.maxExpandedLines;
				truncated.unshift(theme.fg("dim", `… ${remaining} earlier lines`));
				cacheKey = cacheId;
				cacheLines = ["", ...indentToolBodyLines(truncated)];
				return cacheLines;
			}

			cacheKey = cacheId;
			cacheLines = ["", ...indentToolBodyLines(expandedLines.map(applyColor))];
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
			const details = [highlightBashLine(commandLines[0], theme) + (commandLines.length === 1 ? timeoutSuffix : "")];
			const showCount = Math.min(commandLines.length, maxCommandLines + 1);
			for (let i = 1; i < showCount; i++) {
				details.push(highlightBashLine(commandLines[i], theme));
			}
			if (commandLines.length > maxCommandLines + 1) {
				details.push(theme.fg("muted", `... ${commandLines.length - maxCommandLines - 1} more lines`));
			}
			if (commandLines.length > 1 && timeoutSuffix) {
				details.push(theme.fg("muted", timeoutSuffix.trim()));
			}
			return renderToolCallHeaderLines(theme, "EXECUTE", [parens(theme, details[0] ?? "", true), ...details.slice(1)]);
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
