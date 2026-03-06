import type { ExtensionAPI, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { getLanguageFromPath } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import type { EditToolResultDetails } from "pi-ctx-kit/edit-core";
import { EDIT_TOOL_DESCRIPTION, EditArgsSchema, executeEnhancedEdit } from "pi-ctx-kit/edit-core";
import { stripAnsi } from "../ansi.js";
import {
	SplitDiffComponent,
	buildSplitRows,
	countDiffStats,
	extractEditedPath,
	firstText,
	renderDiffMeter,
} from "../split-diff.js";
import { badge, getTextOutput, parens, resolveRelativePath } from "./common.js";

export function registerEditTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: EDIT_TOOL_DESCRIPTION,
		parameters: EditArgsSchema,
		execute: executeEnhancedEdit,
		renderCall(args: any, theme: any) {
			const rawPath = String(args?.path ?? args?.file_path ?? "");
			const relPath = rawPath ? resolveRelativePath(rawPath, process.cwd()) : "";
			const detail = relPath || "(unknown)";
			return new Text(`${badge(theme, "EDIT")} ${parens(theme, detail)}`, 0, 0);
		},
		renderResult(result: any, options: ToolRenderResultOptions, theme: any) {
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
			const details = result.details as EditToolResultDetails | undefined;
			const diff = details?.diff as string | undefined;

			if (!diff) {
				const output = stripAnsi(getTextOutput(result)).trim();
				const fallback = output || "Edit applied";
				return new Text(`${theme.fg("dim", "↳")} ${theme.fg("muted", fallback)}`, 0, 0);
			}

			// Resolve language for syntax highlighting
			const message = firstText(result.content);
			const sourcePath = details?.path ?? extractEditedPath(message);
			const language = sourcePath ? getLanguageFromPath(sourcePath) : undefined;

			// Build summary header with diff stats and meter
			const { additions, removals } = countDiffStats(diff);
			const meter = renderDiffMeter(theme, additions, removals);
			const summary =
				`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
				` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
				` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
				` ${theme.fg("muted", "split")}` +
				(meter ? ` ${meter}` : "");

			// Build split-diff rows and render component
			const rows = buildSplitRows(diff);
			const maxRows = options.expanded ? 160 : 36;
			const split = new SplitDiffComponent(theme, rows, maxRows, language);

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
