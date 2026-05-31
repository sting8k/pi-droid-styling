import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";

import { fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

const PATCH_FLAG = "__compactToolSpacingPatched__";

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

/**
 * Adds a divider line before each tool call block.
 */
export function installCompactToolSpacing(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = ToolExecutionComponent.prototype as any;
	if (!proto) return;

	// Patch render to prepend divider
	const baseRender = proto.render;
	if (typeof baseRender !== "function") return;

	// Cache divider per width to keep stable string references across frames
	let cachedDivider = "";
	let cachedDividerWidth = -1;

	proto.render = function patchedToolRender(this: any, width: number): string[] {
		const lines = baseRender.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;
		if (stripAnsi(lines[0] ?? "").startsWith("┌")) return [...lines, ""];
		const showDivider = getThemeExtra(cachedTheme, "showDivider") !== "false";
		if (!showDivider) return [...lines, ""];
		if (cachedDividerWidth !== width) {
			cachedDivider = buildDividerLine(width);
			cachedDividerWidth = width;
		}
		return [cachedDivider, ...lines, ""];
	};
}
