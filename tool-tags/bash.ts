import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, getTextOutput, parens, replaceTabs } from "./common.js";

const MAX_BASH_PREVIEW_LINES = 5;
const MAX_LINE_CHARS = 2000;
const BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;

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
	return {
		invalidate() {},
		render(width: number): string[] {
			const renderWidth = Math.max(1, width);

			if (!options.expanded) {
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

				if (text.length === 0) return [];

				const tail = replaceTabs(text.slice(scanFrom)).replace(/\r/g, "");
				const shownLines = tail ? tail.split("\n").map((l) => clampLineLength(l)) : [];

				if (shownLines.length === 0) return [];

				const truncatedShown = shownLines.map((line) => theme.fg(color, truncateToWidth(line, renderWidth, "…")));

				// Count remaining lines (lines before scanFrom)
				const remaining = extraLinesBefore + (scanFrom > 0 ? countNewlines(text, 0, scanFrom) : 0);

				if (remaining <= 0) {
					return ["", ...truncatedShown];
				}

				const hint = truncateToWidth(`... ${remaining} more lines, press Ctrl+o to expand`, renderWidth, "…");
				return ["", ...truncatedShown, "", theme.fg("muted", hint)];
			}

			// Expanded: process all lines
			const normalized = replaceTabs(text);
			const logicalLines = normalized.split("\n").map((l) => clampLineLength(l));
			const hasOutput = !(logicalLines.length === 1 && logicalLines[0] === "");

			if (!hasOutput) {
				return [];
			}

			const clamped = logicalLines.join("\n");
			const wrapped = wrapTextWithAnsi(clamped, renderWidth);
			const expandedLines = wrapped.length === 1 && wrapped[0] === "" ? [] : wrapped;
			return ["", ...expandedLines.map((line) => theme.fg(color, line))];
		},
	};
}

export function registerBashTool(pi: ExtensionAPI): void {
	const baseBash = createBashTool(process.cwd());
	pi.registerTool({
		name: baseBash.name,
		label: baseBash.label,
		description: baseBash.description,
		parameters: baseBash.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tool = createBashTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal, onUpdate);
		},
		renderCall(args: any, theme: any) {
			const rawCommand = String(args?.command ?? "...");
			const timeout = args?.timeout;
			const timeoutSuffix = timeout ? ` (timeout ${timeout}s)` : "";
			const commandLines = rawCommand.split("\n");
			const maxCommandLines = 5;
			const firstLine = `${badge(theme, "EXECUTE")} ${parens(theme, commandLines[0] + (commandLines.length === 1 ? timeoutSuffix : ""))}`;
			return {
				invalidate() {},
				render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					const lines = [...wrapTextWithAnsi(firstLine, renderWidth)];
					const showCount = Math.min(commandLines.length, maxCommandLines + 1);
					for (let i = 1; i < showCount; i++) {
						const wrapped = wrapTextWithAnsi(theme.fg("toolOutput", commandLines[i]), renderWidth);
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
		renderResult(result, options, theme: any) {
			const raw = getTextOutput(result);
			if (!options.expanded) {
				// Collapsed: only strip ansi + notice on the tail portion
				// Find last MAX_BASH_PREVIEW_LINES+5 newlines (extra buffer for notice lines)
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
				return createBashResultPreview(theme, tail, options, result.isError ? "error" : "toolOutput", totalLinesBefore);
			}
			const output = stripBashToolNoticeLines(stripAnsi(raw));
			return createBashResultPreview(theme, output, options, result.isError ? "error" : "toolOutput", 0);
		},
	});
}
