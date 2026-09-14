import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, resolveRelativePath, stripTrailingNotice } from "./common.js";
import { markToolCallExecutionStarted } from "./elapsed.js";

function parseWriteSummary(output: string): string | undefined {
	const normalized = stripTrailingNotice(stripAnsi(output ?? "")).trim();
	if (!normalized) return undefined;

	const byteMatch = normalized.match(/\bwrote\s+(\d+)\s+bytes?\b/i);
	if (byteMatch) {
		const bytes = Number(byteMatch[1]);
		if (Number.isFinite(bytes)) {
			return `↳ Wrote ${bytes} ${bytes === 1 ? "byte" : "bytes"}.`;
		}
	}

	const lineMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?\b/i);
	if (lineMatch) {
		const count = Number(lineMatch[1]);
		if (Number.isFinite(count)) {
			return `↳ Wrote ${count} ${count === 1 ? "line" : "lines"}.`;
		}
	}

	return undefined;
}

export function renderWriteCall(args: any, theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const rawPath = String(args?.path ?? args?.file_path ?? "");
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
	const detail = relPath || "(unknown)";
	return renderCompactBoxedToolCall(theme, "Write", `${theme.fg("dim", "Path: ")}${detail}`, {
		widthKey: boxedToolWidthKey("Write", detail),
		state: context?.state,
		isError: Boolean(context?.isError),
		isPartial: Boolean(context?.isPartial),
		isPending: Boolean(context?.isPartial && !context?.hasResult),
	});
}

export function renderWriteResult(result: any, options, theme: any, context: any) {
	clearCompactBoxedFooter(context?.state);
	const output = getTextOutput(result);
	const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
	const detail = relPath || "(unknown)";
	const widthKey = boxedToolWidthKey("Write", detail);
	const referenceLines = [`Path: ${detail}`];

	if (result.isError) {
		return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
			widthKey,
			referenceLines,
			footerLines: [formatBoxedFooter(theme, result, [], context)],
			isError: true,
		});
	}

	if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial), toolCallId: context?.toolCallId });

	const content = String(context?.args?.content ?? "");
	const lineCount = content ? content.split("\n").length : 0;
	if (lineCount > 0) {
		const summary = `↳ Wrote ${lineCount} ${lineCount === 1 ? "line" : "lines"}.`;
		return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
			widthKey,
			referenceLines,
			footerLines: [formatBoxedFooter(theme, result, [], context)],
		});
	}

	const summary = parseWriteSummary(output);
	if (summary) {
		return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
			widthKey,
			referenceLines,
			footerLines: [formatBoxedFooter(theme, result, [], context)],
		});
	}

	const normalized = stripTrailingNotice(stripAnsi(output)).trim();
	const fallback = normalized ? `↳ ${normalized}` : "↳ Wrote file.";
	return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
		widthKey,
		referenceLines,
		footerLines: [formatBoxedFooter(theme, result, [], context)],
	});
}
