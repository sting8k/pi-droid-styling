import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, shortenPath, stripTrailingNotice } from "./common.js";
import { markToolCallExecutionStarted } from "./elapsed.js";

export function renderLsCall(args: any, theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const rawPath = String(args?.path ?? ".");
	const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
	return renderCompactBoxedToolCall(theme, "List", `${theme.fg("dim", "Path: ")}${displayPath}`, {
		widthKey: boxedToolWidthKey("List", displayPath),
		state: context?.state,
		isError: Boolean(context?.isError),
		isPartial: Boolean(context?.isPartial),
		isPending: Boolean(context?.isPartial && !context?.hasResult),
	});
}

export function renderLsResult(result, options, theme: any, context: any) {
	clearCompactBoxedFooter(context?.state);
	const output = stripAnsi(getTextOutput(result)).trimEnd();
	const rawPath = String(context?.args?.path ?? ".");
	const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
	const widthKey = boxedToolWidthKey("List", displayPath);
	const referenceLines = [`Path: ${displayPath}`];
	if (context?.isError) {
		return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
			widthKey,
			referenceLines,
			footerLines: [formatBoxedFooter(theme, result, [], context)],
			isError: true,
		});
	}

	if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial), toolCallId: context?.toolCallId });

	let itemCount = 0;
	if (output && output !== "(empty directory)") {
		const stripped = stripTrailingNotice(output);
		itemCount =
			typeof result.details?.truncation?.outputLines === "number"
				? result.details.truncation.outputLines
				: countLines(stripped);
	}

	const summary = `↳ Listed ${itemCount} ${itemCount === 1 ? "item" : "items"}.`;
	return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
		widthKey,
		referenceLines,
		footerLines: [formatBoxedFooter(theme, result, [], context)],
	});
}
