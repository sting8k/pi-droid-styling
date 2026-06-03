import { CURSOR_MARKER } from "@earendil-works/pi-tui";

import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { profileCount, profileSample } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.render-width-guard.patched");
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

type RenderFunction = (width: number) => string[];

function normalizeWidth(width: number): number {
	const normalized = Math.floor(width);
	return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function isImageRenderLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}

function clampLineWithCursorMarker(line: string, width: number): string {
	const markerIndex = line.indexOf(CURSOR_MARKER);
	if (markerIndex === -1) return clampRenderLineToWidth(line, width);

	const beforeMarker = line.slice(0, markerIndex);
	const afterMarker = line.slice(markerIndex + CURSOR_MARKER.length);
	const lineWithoutMarker = `${beforeMarker}${afterMarker}`;
	const visible = safeVisibleWidth(lineWithoutMarker);
	if (visible <= width) return line;

	profileCount("render.widthGuard.clamped.cursor");
	profileSample("render.widthGuard.overflow.cols", visible - width);

	const beforeWidth = safeVisibleWidth(beforeMarker);
	if (beforeWidth >= width) {
		return `${safeTruncateToWidth(beforeMarker, width, "")}${CURSOR_MARKER}`;
	}

	return `${beforeMarker}${CURSOR_MARKER}${safeTruncateToWidth(afterMarker, width - beforeWidth, "")}`;
}

export function clampRenderLineToWidth(line: string, width: number): string {
	if (width <= 0 || line.length === 0 || isImageRenderLine(line)) return line;
	if (line.includes(CURSOR_MARKER)) return clampLineWithCursorMarker(line, width);

	const visible = safeVisibleWidth(line);
	if (visible <= width) return line;

	profileCount("render.widthGuard.clamped");
	profileSample("render.widthGuard.overflow.cols", visible - width);
	return safeTruncateToWidth(line, width, "");
}

export function clampRenderLinesToWidth(lines: readonly string[], width: number): string[] {
	const renderWidth = normalizeWidth(width);
	if (renderWidth <= 0) return [...lines];
	return lines.map((line) => clampRenderLineToWidth(line, renderWidth));
}

export function installRenderWidthGuard(tui: any): void {
	if (!tui || tui[PATCHED] || typeof tui.render !== "function") return;
	const originalRender = tui.render.bind(tui);
	tui[PATCHED] = true;
	tui.render = function guardedRender(width: number): string[] {
		return clampRenderLinesToWidth(originalRender(width), width);
	};
}
