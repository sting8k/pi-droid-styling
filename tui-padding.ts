import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./performance/tui-proxy-original.js";

/**
 * Add one-column horizontal padding to the entire TUI output.
 * Regular mode wraps TUI.render; Pi 0.84 fullscreen wraps the layout root.
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
const FULLSCREEN_LAYOUT_PATCHED = Symbol.for("pi-droid-styling.tui-padding.fullscreen-layout-patched");
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

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
	const targetWidth = Math.max(0, Math.floor(width));
	if (targetWidth === 0) return padded;
	const visible = safeVisibleWidth(padded);
	if (visible > targetWidth) {
		return safeTruncateToWidth(padded, targetWidth, "");
	}
	if (visible < targetWidth) {
		return `${padded}${" ".repeat(targetWidth - visible)}`;
	}
	return padded;
}

type LayoutComponent = AnyComponent & {
	invalidate?(): void;
	[LAYOUT_NODE]?: () => unknown;
	[FULLSCREEN_LAYOUT_PATCHED]?: true;
};

const HORIZONTAL_GUTTER: LayoutComponent = {
	render: () => [],
};

function installFullscreenTuiPadding(tui: any): boolean {
	if (tui?.mode !== "fullscreen" || typeof tui.setLayoutRoot !== "function") return false;
	const root = tui.layoutRoot as LayoutComponent | undefined;
	const originalLayoutNode = root?.[LAYOUT_NODE];
	if (!root || typeof originalLayoutNode !== "function") return false;
	if (root[FULLSCREEN_LAYOUT_PATCHED]) return true;

	// Fullscreen renders the layout tree directly and never calls TUI.render().
	// Inset the persistent root so layout also shifts cursor and selection geometry.
	const content: LayoutComponent = {
		render: (width) => root.render(width),
		invalidate: () => root.invalidate?.(),
		[LAYOUT_NODE]: () => originalLayoutNode.call(root),
	};
	root[LAYOUT_NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: HORIZONTAL_GUTTER, basis: PAD_LEFT, minSize: PAD_LEFT, maxSize: PAD_LEFT },
			{ component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: HORIZONTAL_GUTTER, basis: PAD_RIGHT, minSize: PAD_RIGHT, maxSize: PAD_RIGHT },
		],
		gap: 0,
		align: "stretch",
	});
	root[FULLSCREEN_LAYOUT_PATCHED] = true;
	tui.requestRender?.(true);
	return true;
}

export function installTuiPadding(tui: AnyComponent): void {
	if (installFullscreenTuiPadding(tui)) return;
	const state = tui as any;
	if (state[PATCHED]) return;
	state[PATCHED] = true;
	state[ORIGINAL_RENDER] ??= getOriginalTuiMethod(tui, "render");

	const paddedTuiRender = function paddedTuiRender(this: unknown, width: number): string[] {
		const innerWidth = getTuiContentInnerWidth(width);
		const lines = (state[ORIGINAL_RENDER] as (w: number) => string[]).call(this, innerWidth);
		return lines.map((line: string) => padTuiContentLine(line, width));
	};
	tui.render = paddedTuiRender;
	rememberTuiMethodWrapper(tui, "render", paddedTuiRender);
}
