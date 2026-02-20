import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createFindTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, countLines, getTextOutput, parens, shortenPath, stripTrailingNotice } from "./common.js";

export function registerFindTool(pi: ExtensionAPI): void {
	const baseFind = createFindTool(process.cwd());
	pi.registerTool({
		name: baseFind.name,
		label: baseFind.label,
		description: baseFind.description,
		parameters: baseFind.parameters,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const tool = createFindTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		},
		renderCall(args: any, theme: any) {
			const pattern = String(args?.pattern ?? "");
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
			return new Text(`${badge(theme, "FIND FILES")} ${parens(theme, detail)}`, 0, 0);
		},
		renderResult(result, _options, theme: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			if (result.isError) {
				return new Text(`\n${theme.fg("error", output || "Error")}`, 0, 0);
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
			return new Text(`${theme.fg("dim", summary)}`, 0, 0);
		},
	});
}
