import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { createGrepTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, countLines, getTextOutput, parens, renderLines, shortenPath, stripTrailingNotice } from "./common.js";

const MAX_GREP_PREVIEW_LINES = 10;

export function registerGrepTool(pi: ExtensionAPI): void {
	const baseGrep = createGrepTool(process.cwd());
	pi.registerTool({
		name: baseGrep.name,
		label: baseGrep.label,
		description: baseGrep.description,
		parameters: baseGrep.parameters,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const tool = createGrepTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		},
		renderCall(args: any, theme: any) {
			const pattern = String(args?.pattern ?? "");
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
			return new Text(`${badge(theme, "SEARCH")} ${parens(theme, detail)}`, 0, 0);
		},
		renderResult(result: any, options: ToolRenderResultOptions, theme: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			const stripped = stripTrailingNotice(output);

			if (result.isError) {
				const body = renderLines(theme, stripped || output || "Error", options, {
					maxLines: MAX_GREP_PREVIEW_LINES,
					color: "error",
				});
				return new Text(`\n${body}`, 0, 0);
			}

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

			const summary = `↳ Found ${matchCount} ${matchCount === 1 ? "match" : "matches"}.`;
			if (!stripped || stripped === "No matches found") {
				return new Text(`${theme.fg("dim", summary)}`, 0, 0);
			}

			const body = renderLines(theme, stripped, options, {
				maxLines: MAX_GREP_PREVIEW_LINES,
				color: "toolOutput",
			});
			return new Text(`${theme.fg("dim", summary)}\n${body}`, 0, 0);
		},
	});
}
