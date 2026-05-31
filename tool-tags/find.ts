import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFindTool } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

export function registerFindTool(pi: ExtensionAPI): void {
	const baseFind = createFindTool(process.cwd());
	pi.registerTool({
		name: baseFind.name,
		label: baseFind.label,
		description: baseFind.description,
		parameters: { ...baseFind.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createFindTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any, context: any) {
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
		},
		renderResult(result, options, theme: any, context: any) {
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
					footerLines: [formatBoxedFooter(theme, result)],
					isError: true,
				});
			}

			if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });

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
				footerLines: [formatBoxedFooter(theme, result)],
			});
		},
	});
}
