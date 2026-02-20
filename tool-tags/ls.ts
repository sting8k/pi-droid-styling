import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLsTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, countLines, getTextOutput, parens, shortenPath, stripTrailingNotice } from "./common.js";

export function registerLsTool(pi: ExtensionAPI): void {
	const baseLs = createLsTool(process.cwd());
	pi.registerTool({
		name: baseLs.name,
		label: baseLs.label,
		description: baseLs.description,
		parameters: baseLs.parameters,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const tool = createLsTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		},
		renderCall(args: any, theme: any) {
			const rawPath = String(args?.path ?? ".");
			const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
			return new Text(`${badge(theme, "LIST DIRECTORY")} ${parens(theme, displayPath)}`, 0, 0);
		},
		renderResult(result, _options, theme: any) {
			const output = stripAnsi(getTextOutput(result)).trimEnd();
			if (result.isError) {
				return new Text(`\n${theme.fg("error", output || "Error")}`, 0, 0);
			}

			let itemCount = 0;
			if (output && output !== "(empty directory)") {
				const stripped = stripTrailingNotice(output);
				itemCount =
					typeof result.details?.truncation?.outputLines === "number"
						? result.details.truncation.outputLines
						: countLines(stripped);
			}

			const summary = `↳ Listed ${itemCount} ${itemCount === 1 ? "item" : "items"}.`;
			return new Text(`${theme.fg("dim", summary)}`, 0, 0);
		},
	});
}
