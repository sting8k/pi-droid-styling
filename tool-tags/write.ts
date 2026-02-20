import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import { badge, getTextOutput, parens, resolveRelativePath, stripTrailingNotice } from "./common.js";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	const kb = bytes / 1024;
	return kb < 1024 ? `${kb.toFixed(1)}KB` : `${(kb / 1024).toFixed(1)}MB`;
}

function countContentLines(content: string): number {
	if (!content) return 0;
	const trimmed = content.replace(/\n+$/, "");
	if (!trimmed) return 0;
	return trimmed.split("\n").length;
}

function parseWriteSummary(output: string): string | undefined {
	const normalized = stripTrailingNotice(stripAnsi(output ?? "")).trim();
	if (!normalized) return undefined;

	// Match enriched format: "wrote N lines, M bytes"
	const fullMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?,\s*(\d+)\s+bytes?\b/i);
	if (fullMatch) {
		const lines = Number(fullMatch[1]);
		const bytes = Number(fullMatch[2]);
		if (Number.isFinite(lines) && Number.isFinite(bytes)) {
			return `↳ (${lines} ${lines === 1 ? "line" : "lines"}, ${formatBytes(bytes)})`;
		}
	}

	// Fallback: bytes only
	const byteMatch = normalized.match(/\bwrote\s+(\d+)\s+bytes?\b/i);
	if (byteMatch) {
		const bytes = Number(byteMatch[1]);
		if (Number.isFinite(bytes)) {
			return `↳ (${formatBytes(bytes)})`;
		}
	}

	// Fallback: lines only
	const lineMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?\b/i);
	if (lineMatch) {
		const count = Number(lineMatch[1]);
		if (Number.isFinite(count)) {
			return `↳ (${count} ${count === 1 ? "line" : "lines"})`;
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
			const result = await tool.execute(toolCallId, params as any, signal);
			// Enrich output with line count so renderResult can display it
			const content = (params as any)?.content ?? "";
			const lines = countContentLines(content);
			if (result?.content) {
				for (const block of result.content) {
					if (block.type === "text" && typeof block.text === "string") {
						block.text = block.text.replace(
							/wrote (\d+) bytes/i,
							`wrote ${lines} lines, $1 bytes`,
						);
					}
				}
			}
			return result;
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
