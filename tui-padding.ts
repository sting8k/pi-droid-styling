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

const PATCHED = Symbol("tui-padding");

export function installTuiPadding(tui: AnyComponent): void {
	if ((tui as any)[PATCHED]) return;
	(tui as any)[PATCHED] = true;

	const origRender = tui.render.bind(tui);
	tui.render = function (width: number): string[] {
		const innerWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
		const lines = origRender(innerWidth);
		return lines.map((line) => {
			const padded = `${PADDING_PREFIX}${line}`;
			if (visibleWidth(padded) > width) {
				return truncateToWidth(padded, width, "");
			}
			return padded;
		});
	};
}
