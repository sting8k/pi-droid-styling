import type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../theme/ansi.js";
import { clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, renderLines, shortenPath, stripTrailingNotice } from "./common.js";
import { markToolCallExecutionStarted } from "./elapsed.js";

const MAX_GREP_PREVIEW_LINES = 10;

export function renderGrepCall(args: any, theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const pattern = String(args?.pattern ?? "");
	const rawPath = String(args?.path ?? ".");
	const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
	const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
	return renderCompactBoxedToolCall(theme, "Search", `${theme.fg("dim", "Query: ")}${detail}`, {
		state: context?.state,
		isError: Boolean(context?.isError),
		isPartial: Boolean(context?.isPartial),
		isPending: Boolean(context?.isPartial && !context?.hasResult),
	});
}

export function renderGrepResult(result: any, options: ToolRenderResultOptions, theme: any, context: any) {
	clearCompactBoxedFooter(context?.state);
	const output = stripAnsi(getTextOutput(result)).trimEnd();
	const stripped = stripTrailingNotice(output);

	if (result.isError) {
		return renderBoxedToolResult(theme, (width) => {
			const body = renderLines(theme, stripped || output || "Error", options, {
				maxLines: MAX_GREP_PREVIEW_LINES,
				color: "error",
				width,
			});
			return body ? body.split("\n") : [];
		}, {
			footerLines: [formatBoxedFooter(theme, result, [], context)],
			isError: true,
		});
	}

	if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial), toolCallId: context?.toolCallId });

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
			footerLines: [formatBoxedFooter(theme, result, [], context)],
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
		footerLines: [formatBoxedFooter(theme, result, [], context)],
	});
}
