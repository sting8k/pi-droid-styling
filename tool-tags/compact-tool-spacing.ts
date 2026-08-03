import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { getPresentationStyle } from "../presentation/state.js";
import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

const PATCH_FLAG = "__compactToolSpacingPatched__";
const PATCH_VERSION_KEY = "__compactToolSpacingPatchVersion__";
const PATCH_VERSION = 3;

let cachedTheme: any = null;

export function setToolSpacingTheme(theme: any): void {
	cachedTheme = theme;
}

function buildDividerLine(width: number): string {
	if (width <= 0) return "";
	const char = getThemeExtra(cachedTheme, "dividerChar");
	const color = getThemeExtra(cachedTheme, "dividerColor");
	const line = char.repeat(width);
	return cachedTheme ? fgHex(cachedTheme, color, line) : line;
}

function trimOuterBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && stripAnsi(lines[start] ?? "").trim() === "") start++;
	while (end > start && stripAnsi(lines[end - 1] ?? "").trim() === "") end--;
	return lines.slice(start, end);
}

function isFullWidthDivider(line: string, width: number): boolean {
	const dividerChar = getThemeExtra(cachedTheme, "dividerChar");
	return Boolean(dividerChar) && stripAnsi(line) === dividerChar.repeat(width);
}

function mergeReasonixSummaryFooter(summary: string, footer: string, width: number): string {
	const separator = ` ${cachedTheme?.fg?.("dim", "·") ?? "·"} `;
	const footerBudget = Math.min(safeVisibleWidth(footer), Math.max(10, Math.floor(width * 0.45)));
	const renderedFooter = safeTruncateToWidth(footer, footerBudget, "…");
	const summaryBudget = Math.max(1, width - safeVisibleWidth(separator) - safeVisibleWidth(renderedFooter));
	return `${safeTruncateToWidth(summary, summaryBudget, "…")}${separator}${renderedFooter}`;
}

export function normalizeReasonixToolLines(lines: string[], width: number, expanded: boolean): string[] {
	const content = trimOuterBlankLines(lines);
	while (content.length > 0 && isFullWidthDivider(content[0] ?? "", width)) content.shift();
	if (content.length === 0) return [];

	let footerIndex = -1;
	for (let index = content.length - 1; index > 0; index--) {
		if (!stripAnsi(content[index] ?? "").includes("◷")) continue;
		footerIndex = index;
		break;
	}
	let summary = content[0] ?? "";
	if (footerIndex > 0) {
		const footer = (content[footerIndex] ?? "").trimStart();
		if (!stripAnsi(summary).includes("◷")) summary = mergeReasonixSummaryFooter(summary, footer, width);
		content.splice(footerIndex, 1);
	}
	content[0] = safeTruncateToWidth(summary, Math.max(1, width), "…");
	return expanded ? content : [content[0] ?? ""];
}

function normalizeBoxedLines(lines: string[]): string[] | undefined {
	const boxStart = lines.findIndex((line) => stripAnsi(line).startsWith("┌"));
	if (boxStart < 0) return undefined;
	let boxEnd = lines.length - 1;
	while (boxEnd > boxStart && stripAnsi(lines[boxEnd] ?? "").trim() === "") boxEnd--;
	return lines.slice(boxStart, boxEnd + 1);
}

/**
 * Normalizes ToolExecution spacing without stacking reload patches.
 * Reasonix removes outer spacers/dividers and folds collapsed output into the
 * summary row. Droid keeps the existing boxed/non-boxed spacing behavior.
 */
export function installCompactToolSpacing(ToolExecutionComponentClass: any = ToolExecutionComponent): void {
	const proto = ToolExecutionComponentClass?.prototype as any;
	if (!proto) return;
	if (proto.render?.[PATCH_VERSION_KEY] === PATCH_VERSION) return;

	const globalState = globalThis as Record<string, unknown>;
	const legacyPatched = Boolean(globalState[PATCH_FLAG]);
	globalState[PATCH_FLAG] = true;

	const baseRender = proto.render;
	if (typeof baseRender !== "function") return;

	// Cache divider per width to keep stable string references across frames
	let cachedDivider = "";
	let cachedDividerWidth = -1;

	const patchedToolRender = function patchedToolRender(this: any, width: number): string[] {
		const lines = baseRender.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;

		if (getPresentationStyle() === "reasonix") {
			return normalizeReasonixToolLines(lines, width, Boolean(this.expanded));
		}

		const boxedLines = normalizeBoxedLines(lines);
		if (boxedLines) return boxedLines;

		// If this session already had the old patch installed, keep its non-boxed
		// spacing output instead of stacking a second divider/trailing blank.
		if (legacyPatched) return lines;

		const showDivider = getThemeExtra(cachedTheme, "showDivider") !== "false";
		if (!showDivider) return [...lines, ""];
		if (cachedDividerWidth !== width) {
			cachedDivider = buildDividerLine(width);
			cachedDividerWidth = width;
		}
		return [cachedDivider, ...lines, ""];
	};
	(patchedToolRender as any)[PATCH_VERSION_KEY] = PATCH_VERSION;
	proto.render = patchedToolRender;
}
