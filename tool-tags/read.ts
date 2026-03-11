import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, countLines, dimWithElapsed, getTextOutput, parens, shortenPath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

export function registerReadTool(pi: ExtensionAPI): void {
	const baseRead = createReadTool(process.cwd());
	pi.registerTool({
		name: baseRead.name,
		label: baseRead.label,
		description: baseRead.description,
		parameters: baseRead.parameters,
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
		renderResult(result: any, _options, theme: any) {
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
			const linesRead =
				typeof result.details?.truncation?.outputLines === "number"
					? result.details.truncation.outputLines
					: countLines(stripped);

			const summary = `↳ Read ${linesRead} ${linesRead === 1 ? "line" : "lines"}.`;
			return new Text(dimWithElapsed(theme, summary, result), 0, 0);
		},
	});
}
