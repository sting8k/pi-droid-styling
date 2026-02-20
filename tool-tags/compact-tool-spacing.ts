import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";

import { fgHex } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

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
 * Make tool blocks compact by removing Box/Text vertical padding.
 * Also adds a divider line before each tool call block.
 */
export function installCompactToolSpacing(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = ToolExecutionComponent.prototype as any;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const baseUpdateDisplay = proto.updateDisplay;
	proto.updateDisplay = function patchedUpdateDisplay(this: any, ...args: any[]) {
		if (this?.contentBox && typeof this.contentBox.paddingY === "number") {
			this.contentBox.paddingY = 0;
		}
		if (this?.contentText && typeof this.contentText.paddingY === "number") {
			this.contentText.paddingY = 0;
		}
		return baseUpdateDisplay.apply(this, args);
	};

	// Patch render to prepend divider
	const baseRender = proto.render;
	if (typeof baseRender !== "function") return;

	proto.render = function patchedToolRender(this: any, width: number): string[] {
		const lines = baseRender.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;
		const divider = buildDividerLine(width);
		return [divider, ...lines, ""];
	};
}
