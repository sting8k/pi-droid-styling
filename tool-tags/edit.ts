import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { createEditToolDefinition, getAgentDir, getLanguageFromPath } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { stripAnsi } from "../ansi.js";
import {
	SplitDiffComponent,
	buildSplitRows,
	countDiffStats,
	extractEditedPath,
	firstText,
	renderDiffMeter,
} from "../split-diff.js";
import { dimWithElapsed, getTextOutput, isExpanded, renderToolCallHeader, resolveRelativePath } from "./common.js";
import { formatToolMetrics, wrapExecuteWithTiming } from "./elapsed.js";

const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type EditCoreModule = {
	EDIT_TOOL_DESCRIPTION: string;
	EditArgsSchema: unknown;
	executeEnhancedEdit: (...args: any[]) => any;
};

async function importEditCore(specifier: string): Promise<EditCoreModule | undefined> {
	try {
		return await import(specifier) as EditCoreModule;
	} catch {
		return undefined;
	}
}

async function loadEditCore(): Promise<EditCoreModule | undefined> {
	const packageImport = await importEditCore("pi-ctx-kit/edit-core");
	if (packageImport) return packageImport;

	const installedPaths = [
		join(getAgentDir(), "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
		join(process.cwd(), ".pi", "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
		join(process.cwd(), "..", "pi-ctx-kit", "edit-core.ts"),
	];

	for (const path of installedPaths) {
		if (!existsSync(path)) continue;
		const editCore = await importEditCore(pathToFileURL(path).href);
		if (editCore) return editCore;
	}

	return undefined;
}

export async function registerEditTool(pi: ExtensionAPI): Promise<void> {
	const editCore = await loadEditCore();
	const baseEdit = createEditToolDefinition(process.cwd());

	pi.registerTool({
		name: "edit",
		label: "edit",
		description: editCore?.EDIT_TOOL_DESCRIPTION ?? baseEdit.description,
		parameters: (editCore?.EditArgsSchema ?? baseEdit.parameters) as any,
		prepareArguments: editCore ? undefined : baseEdit.prepareArguments,
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, onUpdate, ctx) => {
			if (editCore) return editCore.executeEnhancedEdit(toolCallId, params, signal, onUpdate, ctx);
			const tool = createEditToolDefinition(ctx.cwd);
			return tool.execute(toolCallId, params as any, signal, onUpdate, ctx);
		}),
		renderCall(args: any, theme: any) {
			const rawPath = String(args?.path ?? args?.file_path ?? "");
			const relPath = rawPath ? resolveRelativePath(rawPath, process.cwd()) : "";
			const detail = relPath || "(unknown)";
			return renderToolCallHeader(theme, "EDIT", detail);
		},
		renderResult(result: any, options: ToolRenderResultOptions, theme: any, context: any) {
			// Handle partial/streaming state
			if (options.isPartial) {
				return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", "Applying edit...")}`, 0, 0);
			}

			// Handle errors
			if (result.isError) {
				const output = getTextOutput(result);
				return new Text(`${theme.fg("error", stripAnsi(output).trim() || "Error")}`, 0, 0);
			}

			// Extract diff from result details
			const details = result.details as { diff?: string; path?: string } | undefined;
			const diff = details?.diff as string | undefined;

			if (!diff) {
				const output = stripAnsi(getTextOutput(result)).trim();
				const fallback = `↳ ${output || "Edit applied"}`;
				return new Text(dimWithElapsed(theme, fallback, result), 0, 0);
			}

			// Resolve language for syntax highlighting
			const message = firstText(result.content);
			const argPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
			const sourcePath = details?.path ?? (argPath || extractEditedPath(message));
			const language = sourcePath ? getLanguageFromPath(sourcePath) : undefined;

			// Build split-diff rows
			const rows = buildSplitRows(diff);
			const expanded = isExpanded(options);
			const shouldHighlight =
				Boolean(language) &&
				diff.length <= MAX_HIGHLIGHT_DIFF_CHARS &&
				rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;

			// Build summary header with diff stats and meter
			const { additions, removals } = countDiffStats(diff);
			const meter = renderDiffMeter(theme, additions, removals);
			const metrics = formatToolMetrics(result);
			const summary =
				`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
				` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
				` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
				` ${theme.fg("muted", "split")}` +
				(meter ? ` ${meter}` : "") +
				(metrics ? ` ${theme.fg("dim", "–")} ${theme.italic(theme.fg("muted", metrics))}` : "");

			// Render split-diff with syntax colors for small outputs.
			const maxRows = expanded ? 160 : 36;
			const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : undefined);

			return {
				render(width: number): string[] {
					const safeWidth = Math.max(20, width - 1);
					const headerLines = new Text(summary, 0, 0).render(safeWidth);
					return [...headerLines, ...split.render(safeWidth)];
				},
				invalidate(): void {
					split.invalidate();
				},
			};
		},
	});
}
