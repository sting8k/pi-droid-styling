import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, dimWithElapsed, getTextOutput, parens, resolveRelativePath, stripTrailingNotice } from "./common.js";
import { wrapExecuteWithTiming } from "./elapsed.js";

function parseWriteSummary(output: string): string | undefined {
	const normalized = stripTrailingNotice(stripAnsi(output ?? "")).trim();
	if (!normalized) return undefined;

	const lineMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?\b/i);
	if (lineMatch) {
		const count = Number(lineMatch[1]);
		if (Number.isFinite(count)) {
			return `↳ Wrote ${count} ${count === 1 ? "line" : "lines"}.`;
		}
	}

	const byteMatch = normalized.match(/\bwrote\s+(\d+)\s+bytes?\b/i);
	if (byteMatch) {
		const count = Number(byteMatch[1]);
		if (Number.isFinite(count)) {
			return `↳ Wrote ${count} ${count === 1 ? "byte" : "bytes"}.`;
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
		parameters: baseWrite.parameters,
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
			const tool = createWriteTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		}),
		renderCall(args: any, theme: any) {
			const rawPath = String(args?.path ?? args?.file_path ?? "");
			const relPath = rawPath ? resolveRelativePath(rawPath, process.cwd()) : "";
			const detail = relPath || "(unknown)";
			return new Text(`${badge(theme, "WRITE")} ${parens(theme, detail)}`, 0, 0);
		},
		renderResult(result: any, _options, theme: any) {
			const output = getTextOutput(result);

			if (result.isError) {
				return new Text(`${theme.fg("error", stripAnsi(output).trim() || "Error")}`, 0, 0);
			}

			const summary = parseWriteSummary(output);
			if (summary) {
				return new Text(dimWithElapsed(theme, summary, result), 0, 0);
			}

			const normalized = stripTrailingNotice(stripAnsi(output)).trim();
			const fallback = normalized ? `↳ ${normalized}` : "↳ Wrote file.";
			return new Text(dimWithElapsed(theme, fallback, result), 0, 0);
		},
	});
}
