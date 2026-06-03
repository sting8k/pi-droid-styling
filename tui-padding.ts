import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";

/**
 * Add horizontal padding to the entire TUI output.
 * Wraps TUI.render to reduce width and prepend spaces to every line.
 */


interface AnyComponent {
	render(width: number): string[];
}

const PAD_LEFT = 1;
const PAD_RIGHT = 1;
const PADDING_PREFIX = " ".repeat(PAD_LEFT);
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM_IMAGE_PREFIX = "\x1b]1337;File=";

const PATCHED = Symbol.for("pi-droid-styling.tui-padding.patched");
const ORIGINAL_RENDER = Symbol.for("pi-droid-styling.tui-padding.original-render");

function isTerminalImageLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM_IMAGE_PREFIX);
}

export function getTuiContentInnerWidth(width: number): number {
	return Math.max(1, width - PAD_LEFT - PAD_RIGHT);
}

export function getTuiContentCursorColumn(col: number, width: number): number {
	return Math.max(1, Math.min(width, col + PAD_LEFT));
}

export function padTuiContentLine(line: string, width: number): string {
	const padded = `${PADDING_PREFIX}${line}`;
	if (isTerminalImageLine(line)) return padded;
	if (safeVisibleWidth(padded) > width) {
		return safeTruncateToWidth(padded, width, "");
	}
	return padded;
}

export function installTuiPadding(tui: AnyComponent): void {
	const state = tui as any;
	if (state[PATCHED]) return;
	state[PATCHED] = true;
	state[ORIGINAL_RENDER] ??= tui.render.bind(tui);

	tui.render = function paddedTuiRender(width: number): string[] {
		const innerWidth = getTuiContentInnerWidth(width);
		const lines = state[ORIGINAL_RENDER](innerWidth);
		return lines.map((line: string) => padTuiContentLine(line, width));
	};
}
