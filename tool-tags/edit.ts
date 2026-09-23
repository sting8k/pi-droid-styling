import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition, getAgentDir, getLanguageFromPath } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { safeTruncateToWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import {
	SplitDiffComponent,
	buildSplitRows,
	countDiffStats,
	extractEditedPath,
	firstText,
	renderDiffMeter,
} from "../split-diff.js";
import { formatBoxedFooter, getTextOutput, isExpanded, renderBoxedToolCall, renderBoxedToolResult, resolveRelativePath } from "./common.js";
import { markToolCallExecutionStarted, wrapExecuteWithTiming } from "./elapsed.js";

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

/** Script-mode edit (pi-utils US-003): args.paths is the declared file list. */
function scriptModePaths(args: any): string[] | null {
	const paths = args?.paths;
	return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : null;
}

/** Strip unified-patch file headers (---/+++/diff/index) — parseDiffLine would misread them as +/- lines. @@ hunks stay: they seed split-diff line numbers. */
function stripPatchHeaders(patch: string): string {
	return patch
		.split("\n")
		.filter((l) => !/^(diff |index |--- |\+\+\+ |new file|deleted file)/.test(l))
		.join("\n");
}

/**
 * Split a script-mode unified patch into per-file sections so multi-file
 * edits stay attributable. A file header is `--- ` + `+++ ` directly followed
 * by an @@ hunk; a patch without such headers stays one untitled section.
 */
function splitPatchFiles(patch: string): Array<{ path?: string; body: string }> {
	const lines = patch.split("\n");
	const files: Array<{ path?: string; lines: string[] }> = [];
	let current: { path?: string; lines: string[] } | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const next = lines[i + 1] ?? "";
		if (line.startsWith("--- ") && next.startsWith("+++ ") && (lines[i + 2] ?? "").startsWith("@@")) {
			current = { path: next.slice(4).replace(/^b\//, ""), lines: [] };
			files.push(current);
			i++;
			continue;
		}
		if (!current) {
			current = { lines: [] };
			files.push(current);
		}
		current.lines.push(line);
	}
	return files.map((file) => ({
		path: file.path,
		body: file.path ? file.lines.join("\n") : stripPatchHeaders(file.lines.join("\n")),
	}));
}

function countRowStats(rows: Array<{ left?: unknown; right?: unknown; kind: string }>): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const row of rows) {
		if (row.kind === "context") continue;
		if (row.right) additions += 1;
		if (row.left) removals += 1;
	}
	return { additions, removals };
}

/** Multi-line tool output as one box row per line — an embedded newline breaks the box. */
function outputRows(theme: any, text: string, color: string, firstPrefix = ""): string[] {
	return text.split("\n").map((line, index) => theme.fg(color, index === 0 ? `${firstPrefix}${line}` : line));
}

export function renderEditCall(args: any, theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const paths = scriptModePaths(args);
	let label = "Path: ";
	let detail: string;
	if (paths && paths.length > 0) {
		label = "Paths: ";
		const shown = paths.length > 2 ? `${paths.length} paths` : paths.map((p) => resolveRelativePath(p, cwd) || p).join(", ");
		const lang = typeof args?.lang === "string" && args.lang ? ` (${args.lang})` : "";
		detail = shown + lang;
	} else {
		const rawPath = String(args?.path ?? args?.file_path ?? "");
		const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
		detail = relPath || "(unknown)";
	}
	return renderBoxedToolCall(theme, "Edit", [`${theme.fg("dim", label)}${detail}`], {
		isError: Boolean(context?.isError),
		isPartial: Boolean(context?.isPartial),
		isPending: Boolean(context?.isPartial && !context?.hasResult),
	});
}

export function renderEditResult(result: any, options: ToolRenderResultOptions, theme: any, context: any) {
	// Handle partial/streaming state
	if (options.isPartial) {
		return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "↳")} ${theme.fg("muted", "Applying edit...")}`], { isPartial: true });
	}

	// Handle errors
	if (result.isError) {
		const output = stripAnsi(getTextOutput(result)).trim() || "Error";
		return renderBoxedToolResult(theme, () => outputRows(theme, output, "error"), {
			footerLines: [formatBoxedFooter(theme, result, [], context)],
			isError: true,
		});
	}

	// Extract diff from result details. Script-mode edit carries a unified
	// patch; default edit keeps its native `diff` format untouched.
	const scriptMode = scriptModePaths(context?.args) !== null;
	const details = result.details as { diff?: string; patch?: string; path?: string } | undefined;
	const rawDiff = scriptMode ? (details?.patch ?? details?.diff) : details?.diff;
	const sections = rawDiff ? (scriptMode ? splitPatchFiles(rawDiff) : [{ body: rawDiff }]) : [];
	const diff = sections.map((section) => section.body).join("\n");

	if (!diff) {
		const output = stripAnsi(getTextOutput(result)).trim() || "Edit applied";
		return renderBoxedToolResult(theme, () => outputRows(theme, output, "dim", "↳ "), {
			footerLines: [formatBoxedFooter(theme, result, [], context)],
		});
	}

	// Resolve language for syntax highlighting
	const message = firstText(result.content);
	const argPath = String(context?.args?.path ?? context?.args?.file_path ?? (scriptMode ? (context?.args?.paths?.[0] ?? "") : ""));
	const sourcePath = details?.path ?? (argPath || extractEditedPath(message));
	const language = sourcePath ? getLanguageFromPath(sourcePath) : undefined;

	// Build split-diff rows: one component per file, titled when several.
	const expanded = isExpanded(options);
	const maxRows = expanded ? 160 : 36;
	const titled = sections.length > 1;
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const parts = sections.map((section) => {
		const rows = buildSplitRows(section.body);
		const sectionLanguage = section.path ? getLanguageFromPath(section.path) : language;
		const shouldHighlight =
			Boolean(sectionLanguage) &&
			section.body.length <= MAX_HIGHLIGHT_DIFF_CHARS &&
			rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;
		const title = titled && section.path ? `▸ ${resolveRelativePath(section.path, cwd) || section.path}` : undefined;
		const split = new SplitDiffComponent(
			theme,
			rows,
			titled ? Math.max(6, Math.floor(maxRows / sections.length)) : maxRows,
			shouldHighlight ? sectionLanguage : undefined,
		);
		return { title, split, rows };
	});

	// Build summary header with diff stats and meter
	// Script-mode bodies carry no file headers, so count parsed rows: a
	// content line like "+---" must count, not be skipped as a header.
	const { additions, removals } = scriptMode ? countRowStats(parts.flatMap((part) => part.rows)) : countDiffStats(diff);
	const meter = renderDiffMeter(theme, additions, removals);
	const summary =
		`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
		` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
		` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
		` ${theme.fg("muted", "split")}` +
		(meter ? ` ${meter}` : "");

	return renderBoxedToolResult(theme, {
		render(width: number): string[] {
			const safeWidth = Math.max(20, width);
			const headerLines = new Text(summary, 0, 0).render(safeWidth);
			const body = parts.flatMap(({ title, split }) => [
				...(title ? [safeTruncateToWidth(theme.fg("muted", title), safeWidth, "…")] : []),
				...split.render(safeWidth),
			]);
			return [...headerLines, ...body];
		},
		invalidate(): void {
			for (const { split } of parts) split.invalidate();
		},
	}, {
		footerLines: [formatBoxedFooter(theme, result, [], context)],
	});
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
		renderCall: renderEditCall,
		renderResult: renderEditResult,
	});
}
