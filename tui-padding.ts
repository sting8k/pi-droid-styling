/**
 * Add horizontal padding to the entire TUI output.
 * Wraps TUI.render to reduce width and prepend spaces to every line.
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

interface AnyComponent {
	render(width: number): string[];
}

const PAD_LEFT = 1;
const PAD_RIGHT = 1;
const PADDING_PREFIX = " ".repeat(PAD_LEFT);

const PATCHED = Symbol.for("pi-droid-styling.tui-padding.patched");
const ORIGINAL_RENDER = Symbol.for("pi-droid-styling.tui-padding.original-render");

export function installTuiPadding(tui: AnyComponent): void {
	const state = tui as any;
	if (state[PATCHED]) return;
	state[PATCHED] = true;
	state[ORIGINAL_RENDER] ??= tui.render.bind(tui);

	tui.render = function paddedTuiRender(width: number): string[] {
		const innerWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
		const lines = state[ORIGINAL_RENDER](innerWidth);
		return lines.map((line: string) => {
			const padded = `${PADDING_PREFIX}${line}`;
			if (visibleWidth(padded) > width) {
				return truncateToWidth(padded, width, "");
			}
			return padded;
		});
	};
}
