import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, shortenPath, stripTrailingNotice } from "./common.js";
import { markToolCallExecutionStarted } from "./elapsed.js";

export function renderFindCall(args: any, theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const pattern = String(args?.pattern ?? "");
	const rawPath = String(args?.path ?? ".");
	const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
	const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
	return renderCompactBoxedToolCall(theme, "Find", `${theme.fg("dim", "Query: ")}${detail}`, {
		widthKey: boxedToolWidthKey("Find", detail),
		state: context?.state,
		isError: Boolean(context?.isError),
		isPartial: Boolean(context?.isPartial),
		isPending: Boolean(context?.isPartial && !context?.hasResult),
	});
}

export function renderFindResult(result, options, theme: any, context: any) {
	clearCompactBoxedFooter(context?.state);
	const output = stripAnsi(getTextOutput(result)).trimEnd();
	const pattern = String(context?.args?.pattern ?? "");
	const rawPath = String(context?.args?.path ?? ".");
	const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
	const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
	const widthKey = boxedToolWidthKey("Find", detail);
	const referenceLines = [`Query: ${detail}`];
	if (context?.isError) {
		return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
			widthKey,
			referenceLines,
			footerLines: [formatBoxedFooter(theme, result, [], context)],
			isError: true,
		});
	}

	if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial), toolCallId: context?.toolCallId });

	let fileCount = 0;
	if (output && output !== "No files found matching pattern") {
		const stripped = stripTrailingNotice(output);
		fileCount =
			typeof result.details?.truncation?.outputLines === "number"
				? result.details.truncation.outputLines
				: countLines(stripped);
	}

	const summary = `↳ Found ${fileCount} ${fileCount === 1 ? "file" : "files"}.`;
	return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
		widthKey,
		referenceLines,
		footerLines: [formatBoxedFooter(theme, result, [], context)],
	});
}
