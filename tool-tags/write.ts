import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, getTextOutput, parens, resolveRelativePath, stripTrailingNotice } from "./common.js";

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
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const tool = createWriteTool(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal);
		},
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
				return new Text(`${theme.fg("dim", summary)}`, 0, 0);
			}

			const normalized = stripTrailingNotice(stripAnsi(output)).trim();
			if (normalized) {
				return new Text(`${theme.fg("dim", `↳ ${normalized}`)}`, 0, 0);
			}

			return new Text(`${theme.fg("dim", "↳ Wrote file.")}`, 0, 0);
		},
	});
}
