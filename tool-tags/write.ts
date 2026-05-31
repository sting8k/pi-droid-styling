import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWriteTool } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../theme/ansi.js";
import { boxedToolWidthKey, formatBoxedFooter, getTextOutput, renderBoxedToolCall, renderBoxedToolResult, resolveRelativePath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

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

export function registerWriteTool(pi: ExtensionAPI): void {
	const baseWrite = createWriteTool(process.cwd());
	pi.registerTool({
		name: baseWrite.name,
		label: baseWrite.label,
		description: baseWrite.description,
		parameters: { ...baseWrite.parameters },
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createWriteTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any, context: any) {
			const rawPath = String(args?.path ?? args?.file_path ?? "");
			const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
			const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
			const detail = relPath || "(unknown)";
			return renderBoxedToolCall(theme, "Write", [`${theme.fg("dim", "Path: ")}${detail}`], {
				widthKey: boxedToolWidthKey("Write", detail),
				isError: Boolean(context?.isError),
				isPartial: Boolean(context?.isPartial),
				isPending: Boolean(context?.isPartial && !context?.hasResult),
			});
		},
		renderResult(result: any, _options, theme: any, context: any) {
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
					footerLines: [formatBoxedFooter(theme, result)],
					isError: true,
				});
			}

			const content = String(context?.args?.content ?? "");
			const lineCount = content ? content.split("\n").length : 0;
			if (lineCount > 0) {
				const summary = `↳ Wrote ${lineCount} ${lineCount === 1 ? "line" : "lines"}.`;
				return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
				});
			}

			const summary = parseWriteSummary(output);
			if (summary) {
				return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
					widthKey,
					referenceLines,
					footerLines: [formatBoxedFooter(theme, result)],
				});
			}

			const normalized = stripTrailingNotice(stripAnsi(output)).trim();
			const fallback = normalized ? `↳ ${normalized}` : "↳ Wrote file.";
			return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
				widthKey,
				referenceLines,
				footerLines: [formatBoxedFooter(theme, result)],
			});
		},
	});
}
