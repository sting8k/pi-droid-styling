import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLsTool } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, clearCompactBoxedFooter, countLines, formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolResult, renderCompactBoxedFooter, renderCompactBoxedToolCall, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

export function registerLsTool(pi: ExtensionAPI): void {
	const baseLs = createLsTool(process.cwd());
	pi.registerTool({
		name: baseLs.name,
		label: baseLs.label,
		description: baseLs.description,
		parameters: { ...baseLs.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createLsTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any, context: any) {
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			return renderCompactBoxedToolCall(theme, "List", `${theme.fg("dim", "Path: ")}${displayPath}`, {
				widthKey: boxedToolWidthKey("List", displayPath),
				state: context?.state,
				isError: Boolean(context?.isError),
				isPartial: Boolean(context?.isPartial),
				isPending: Boolean(context?.isPartial && !context?.hasResult),
			});
		},
		renderResult(result, options, theme: any, context: any) {
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
					footerLines: [formatBoxedFooter(theme, result)],
					isError: true,
				});
			}

			if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });

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
				footerLines: [formatBoxedFooter(theme, result)],
			});
		},
	});
}
