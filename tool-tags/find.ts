import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createFindTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { countLines, dimWithElapsed, getTextOutput, indentToolBody, renderToolCallHeader, shortenPath, stripTrailingNotice } from "./common.js";
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
		renderCall(args: any, theme: any) {
			const pattern = String(args?.pattern ?? "");
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
			return renderToolCallHeader(theme, "FIND FILES", detail);
		},
		renderResult(result, _options, theme: any, context: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			if (context?.isError) {
				return new Text(`\n${theme.fg("error", indentToolBody(output || "Error"))}`, 0, 0);
			}

			let fileCount = 0;
			if (output && output !== "No files found matching pattern") {
				const stripped = stripTrailingNotice(output);
				fileCount =
					typeof result.details?.truncation?.outputLines === "number"
						? result.details.truncation.outputLines
						: countLines(stripped);
			}

			const summary = `↳ Found ${fileCount} ${fileCount === 1 ? "file" : "files"}.`;
			return new Text(dimWithElapsed(theme, summary, result), 0, 0);
		},
	});
}
