import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

const PATCH_FLAG = "__compactToolSpacingPatched__";
const PATCH_VERSION_KEY = "__compactToolSpacingPatchVersion__";
const PATCH_VERSION = 2;

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

function normalizeBoxedLines(lines: string[]): string[] | undefined {
	const boxStart = lines.findIndex((line) => stripAnsi(line).startsWith("┌"));
	if (boxStart < 0) return undefined;
	let boxEnd = lines.length - 1;
	while (boxEnd > boxStart && stripAnsi(lines[boxEnd] ?? "").trim() === "") boxEnd--;
	return lines.slice(boxStart, boxEnd + 1);
}

/**
 * Adds a divider line before non-boxed tool call blocks.
 * Boxed renderers already draw their own boundary, so trim Pi core's leading
 * spacer and avoid adding another trailing spacer around them.
 */
export function installCompactToolSpacing(): void {
	const proto = ToolExecutionComponent.prototype as any;
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
