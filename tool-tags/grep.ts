import type { ExtensionAPI, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, renderLines, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

const MAX_GREP_PREVIEW_LINES = 10;

export function registerGrepTool(pi: ExtensionAPI): void {
	const baseGrep = createGrepTool(process.cwd());
	pi.registerTool({
		name: baseGrep.name,
		label: baseGrep.label,
		description: baseGrep.description,
		parameters: { ...baseGrep.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createGrepTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any, context: any) {
			const pattern = String(args?.pattern ?? "");
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
			return renderCompactBoxedToolCall(theme, "Search", `${theme.fg("dim", "Query: ")}${detail}`, {
				widthKey: boxedToolWidthKey("Search", detail),
				state: context?.state,
				isError: Boolean(context?.isError),
				isPartial: Boolean(context?.isPartial),
				isPending: Boolean(context?.isPartial && !context?.hasResult),
			});
		},
		renderResult(result: any, options: ToolRenderResultOptions, theme: any, context: any) {
			clearCompactBoxedFooter(context?.state);
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			const stripped = stripTrailingNotice(output);
			const pattern = String(context?.args?.pattern ?? "");
			const rawPath = String(context?.args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
			const widthKey = boxedToolWidthKey("Search", detail);
			const referenceLines = [`Query: ${detail}`];

			if (result.isError) {
				return renderBoxedToolResult(theme, (width) => {
					const body = renderLines(theme, stripped || output || "Error", options, {
						maxLines: MAX_GREP_PREVIEW_LINES,
						color: "error",
						width,
					});
					return body ? body.split("\n") : [];
				}, {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
					isError: true,
				});
			}

			if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });

			let matchCount = 0;
			if (stripped && stripped !== "No matches found") {
				const lines = stripped.split("\n");
				matchCount = lines.filter((line) => /:\d+:/.test(line)).length;

				if (matchCount === 0) {
					matchCount = countLines(stripped);
				}

				if (typeof result.details?.matchLimitReached === "number") {
					matchCount = Math.max(matchCount, result.details.matchLimitReached);
				}
			}

			const summary = theme.fg("dim", `↳ Found ${matchCount} ${matchCount === 1 ? "match" : "matches"}.`);
			if (!stripped || stripped === "No matches found") {
				return renderBoxedToolResult(theme, () => [summary], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
				});
			}

			return renderBoxedToolResult(theme, (width) => {
				const body = renderLines(theme, stripped, options, {
					maxLines: MAX_GREP_PREVIEW_LINES,
					color: "toolOutput",
					width,
				});
				return [summary, ...(body ? body.split("\n") : [])];
			}, {
				widthKey,
				referenceLines,
				footerLines: [formatBoxedFooter(theme, result)],
			});
		},
	});
}
