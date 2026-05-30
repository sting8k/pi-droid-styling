import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool, getLanguageFromPath, highlightCode } from "@mariozechner/pi-coding-agent";
import { wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { loadConfig } from "../config.js";
import { boxedToolWidthKey, countLines, extractTrailingNotice, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolCall, renderBoxedToolResult, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

const MAX_HIGHLIGHT_OUTPUT_CHARS = 12000;
const MAX_HIGHLIGHT_OUTPUT_LINES = 300;

type NumberedReadLine = {
	lineNumber: string;
	content: string;
};

type ParsedReadOutput = {
	fileHash?: string;
	numberedLines?: NumberedReadLine[];
	body: string;
};

function parseReadOutput(text: string): ParsedReadOutput {
	const fileHashMatch = text.match(/^fileHash: ([^\n]+)\n\n/);
	const body = fileHashMatch ? text.slice(fileHashMatch[0].length) : text;
	const rawLines = body ? body.split("\n") : [];
	const numberedLines = rawLines.map((line) => line.match(/^\s*(\d+)\| ?(.*)$/));

	if (numberedLines.length > 0 && numberedLines.every(Boolean)) {
		return {
			fileHash: fileHashMatch?.[1],
			body: numberedLines.map((match) => match?.[2] ?? "").join("\n"),
			numberedLines: numberedLines.map((match) => ({
				lineNumber: match?.[1] ?? "",
				content: match?.[2] ?? "",
			})),
		};
	}

	return { fileHash: fileHashMatch?.[1], body };
}

export function registerReadTool(pi: ExtensionAPI): void {
	const baseRead = createReadTool(process.cwd());
	pi.registerTool({
		name: baseRead.name,
		label: baseRead.label,
		description: baseRead.description,
		parameters: { ...baseRead.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createReadTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any, context: any) {
			const rawPath = String(args?.path ?? args?.file_path ?? "");
			const path = shortenPath(rawPath);
			const offset = args?.offset;
			const limit = args?.limit;

			let range = "";
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				range = `:${start}${end ? `-${end}` : ""}`;
			}

			const detail = path ? `${path}${range}` : "(unknown)";
			return renderBoxedToolCall(theme, "Read", [`${theme.fg("dim", "Path: ")}${detail}`], {
				widthKey: boxedToolWidthKey("Read", detail),
				isError: Boolean(context?.isError),
				isPartial: Boolean(context?.isPartial),
				isPending: Boolean(context?.isPartial && !context?.hasResult),
			});
		},
		renderResult(result: any, options, theme: any, context: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
			const path = shortenPath(rawPath);
			const offset = context?.args?.offset;
			const limit = context?.args?.limit;
			let range = "";
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				range = `:${start}${end ? `-${end}` : ""}`;
			}
			const detail = path ? `${path}${range}` : "(unknown)";
			const widthKey = boxedToolWidthKey("Read", detail);
			const referenceLines = [`Path: ${detail}`];

			if (result.isError) {
				return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
					isError: true,
				});
			}

			const imageCount = Array.isArray(result.content)
				? result.content.filter((contentBlock: any) => contentBlock?.type === "image").length
				: 0;
			if (imageCount > 0) {
				const summary = `↳ Read ${imageCount} ${imageCount === 1 ? "image" : "images"}.`;
				return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
				});
			}

			const stripped = stripTrailingNotice(output);
			const parsed = parseReadOutput(stripped);
			const truncationNotice = extractTrailingNotice(output);
			const linesRead =
				typeof result.details?.truncation?.outputLines === "number"
					? result.details.truncation.outputLines
					: parsed.numberedLines?.length ?? countLines(parsed.body);

			const summary = theme.fg("dim", `↳ Read ${linesRead} ${linesRead === 1 ? "line" : "lines"}.`);

			if (!isExpanded(options, context?.state)) {
				return renderBoxedToolResult(theme, () => [summary], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
				});
			}

			// Expanded: show syntax-highlighted content
			const filePath = String(context?.args?.path ?? context?.args?.file_path ?? "");
			const lang = getLanguageFromPath(filePath);
			let cacheKey = "";
			let cacheLines: string[] | null = null;
			const body = {
				invalidate() {
					cacheKey = "";
					cacheLines = null;
				},
				render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					const cfg = loadConfig();
					const maxLines = cfg.maxExpandedLines;
					const expanded = isExpanded(options, context?.state);
					const cacheId = `${renderWidth}|${expanded ? 1 : 0}|${maxLines}|${cfg.dimToolOutput ? 1 : 0}`;
					if (cacheLines && cacheKey === cacheId) return cacheLines;

					const footer: string[] = [];
					if (truncationNotice) footer.push(theme.fg("warning", truncationNotice));
					footer.push("", summary);
					const budget = maxLines > 0 ? maxLines - footer.length : 0;
					const renderPlain = (text: string): string[] => {
						const out: string[] = [];
						for (const line of text.split("\n")) {
							out.push(...wrapTextWithAnsi(theme.fg("toolOutput", line), renderWidth));
						}
						return out;
					};
					const lineCount = parsed.numberedLines?.length ?? countLines(parsed.body);
					const shouldHighlight =
						expanded &&
						Boolean(lang) &&
						parsed.body.length <= MAX_HIGHLIGHT_OUTPUT_CHARS &&
						lineCount <= MAX_HIGHLIGHT_OUTPUT_LINES;

					const renderBody = (): string[] => {
						if (!parsed.numberedLines) return renderPlain(parsed.fileHash ? `fileHash: ${parsed.fileHash}\n\n${parsed.body}` : parsed.body);

						let bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
						if (shouldHighlight && lang) {
							try {
								bodyLines = highlightCode(parsed.body, lang);
							} catch {
								bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
							}
						}

						const out: string[] = [];
						if (parsed.fileHash) out.push(theme.fg("muted", `fileHash: ${parsed.fileHash}`), "");

						const numberWidth = Math.max(...parsed.numberedLines.map((line) => line.lineNumber.length));
						const gutterWidth = numberWidth + 3;
						const contentWidth = Math.max(1, renderWidth - gutterWidth);
						for (let i = 0; i < parsed.numberedLines.length; i++) {
							const numberedLine = parsed.numberedLines[i]!;
							const wrapped = wrapTextWithAnsi(bodyLines[i] ?? "", contentWidth);
							const gutter = theme.fg("dim", `${numberedLine.lineNumber.padStart(numberWidth)} │ `);
							const continuation = theme.fg("dim", `${"".padStart(numberWidth)} │ `);
							out.push(`${gutter}${wrapped[0] ?? ""}`);
							out.push(...wrapped.slice(1).map((line) => `${continuation}${line}`));
						}
						return out;
					};

					const highlighted = renderBody();
					if (maxLines > 0 && highlighted.length > budget) {
						const truncated = highlighted.slice(0, budget);
						const remaining = highlighted.length - budget;
						truncated.push(theme.fg("dim", `… ${remaining} more lines`));
						truncated.push(...footer);
						cacheKey = cacheId;
						cacheLines = truncated;
						return cacheLines;
					}
					highlighted.push(...footer);
					cacheKey = cacheId;
					cacheLines = highlighted;
					return cacheLines;
				},
			};
			return renderBoxedToolResult(theme, body, {
				widthKey,
				referenceLines,
				footerLines: [formatBoxedFooter(theme, result)],
			});
		},
	});
}
