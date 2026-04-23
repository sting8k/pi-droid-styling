import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool, getLanguageFromPath, highlightCode } from "@mariozechner/pi-coding-agent";
import { Text, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { loadConfig } from "../config.js";
import { badge, countLines, dimWithElapsed, extractTrailingNotice, getTextOutput, isExpanded, parens, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

const MAX_HIGHLIGHT_OUTPUT_CHARS = 12000;
const MAX_HIGHLIGHT_OUTPUT_LINES = 300;

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
		renderCall(args: any, theme: any) {
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
			return new Text(`${badge(theme, "READ")} ${parens(theme, detail)}`, 0, 0);
		},
		renderResult(result: any, options, theme: any, context: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();

			if (result.isError) {
				return new Text(`${theme.fg("error", output || "Error")}`, 0, 0);
			}

			const imageCount = Array.isArray(result.content)
				? result.content.filter((contentBlock: any) => contentBlock?.type === "image").length
				: 0;
			if (imageCount > 0) {
				const summary = `↳ Read ${imageCount} ${imageCount === 1 ? "image" : "images"}.`;
				return new Text(`${theme.fg("dim", summary)}`, 0, 0);
			}

			const stripped = stripTrailingNotice(output);
			const truncationNotice = extractTrailingNotice(output);
			const linesRead =
				typeof result.details?.truncation?.outputLines === "number"
					? result.details.truncation.outputLines
					: countLines(stripped);

			const summary = dimWithElapsed(theme, `↳ Read ${linesRead} ${linesRead === 1 ? "line" : "lines"}.`, result);

			if (!isExpanded(options)) {
				return new Text(summary, 0, 0);
			}

			// Expanded: show syntax-highlighted content
			const filePath = String(context?.args?.path ?? context?.args?.file_path ?? "");
			const lang = getLanguageFromPath(filePath);
			return {
				invalidate() {},
				render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					const cfg = loadConfig();
					const maxLines = cfg.maxExpandedLines;
					const footer: string[] = [];
					if (truncationNotice) footer.push(theme.fg("warning", truncationNotice));
					footer.push("", summary);
					const budget = maxLines > 0 ? maxLines - footer.length : 0;
					const renderPlain = (): string[] => {
						const out: string[] = [];
						for (const line of stripped.split("\n")) {
							out.push(...wrapTextWithAnsi(theme.fg("toolOutput", line), renderWidth));
						}
						return out;
					};
					const lineCount = countLines(stripped);
					const shouldHighlight =
						isExpanded(options) &&
						Boolean(lang) &&
						stripped.length <= MAX_HIGHLIGHT_OUTPUT_CHARS &&
						lineCount <= MAX_HIGHLIGHT_OUTPUT_LINES;

					let highlighted: string[] = [];
					if (shouldHighlight && lang) {
						try {
							highlighted = highlightCode(stripped, lang).flatMap((l) => wrapTextWithAnsi(l, renderWidth));
						} catch {
							highlighted = renderPlain();
						}
					} else {
						highlighted = renderPlain();
					}
					if (maxLines > 0 && highlighted.length > budget) {
						const truncated = highlighted.slice(0, budget);
						const remaining = highlighted.length - budget;
						truncated.push(theme.fg("dim", `… ${remaining} more lines`));
						truncated.push(...footer);
						return ["", ...truncated];
					}
					highlighted.push(...footer);
					return ["", ...highlighted];
				},
			};
		},
	});
}
