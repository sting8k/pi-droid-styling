import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ERASE_LINE, RESET_BACKGROUND, bgHexAnsi, keepAnsiBackgroundAcrossResets, wrapAnsiBackground } from "./ansi.js";
import { safeVisibleWidth } from "../render-budget.js";
import { getThemePageBackground } from "./theme-extras.js";

const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

function isImageRenderLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}

export function resolveFrameBackgroundAnsi(theme: any): string {
	const pageBg = getThemePageBackground(theme);
	const result = pageBg ? bgHexAnsi(theme, pageBg) : "";
	writeFrameBackgroundDebug({
		type: "resolve",
		pid: process.pid,
		at: new Date().toISOString(),
		themeName: typeof theme?.name === "string" ? theme.name : "",
		sourcePath: typeof theme?.sourcePath === "string" ? theme.sourcePath : "",
		colorMode: readThemeColorMode(theme),
		pageBg,
		result,
	});
	return result;
}

function readThemeColorMode(theme: any): string {
	try {
		return typeof theme?.getColorMode === "function" ? String(theme.getColorMode() ?? "") : "";
	} catch {
		return "";
	}
}

function isFrameBackgroundDebugEnabled(): boolean {
	return process.env.PI_DROID_DEBUG_FRAME_BG === "1" || Boolean(process.env.PI_DROID_DEBUG_FRAME_BG_LOG);
}

function frameBackgroundDebugLogPath(): string {
	const explicitPath = process.env.PI_DROID_DEBUG_FRAME_BG_LOG;
	if (explicitPath) return explicitPath;
	const debugDir = process.env.PI_DROID_RENDER_DEBUG_DIR || join(tmpdir(), "pi-droid-render-debug");
	return join(debugDir, `frame-bg-${process.pid}.jsonl`);
}

function writeFrameBackgroundDebug(value: unknown): void {
	if (!isFrameBackgroundDebugEnabled()) return;
	try {
		const path = frameBackgroundDebugLogPath();
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
	} catch {
		// Debug instrumentation must not affect rendering.
	}
}

export function paintFrameBackgroundLine(line: string, bgAnsi: string, targetWidth = 0): string {
	const text = String(line);
	if (!bgAnsi || isImageRenderLine(text)) return text;
	const body = keepAnsiBackgroundAcrossResets(text, bgAnsi);
	const width = Number.isFinite(targetWidth) ? Math.max(0, Math.floor(targetWidth)) : 0;
	const fill = width > 0 ? " ".repeat(Math.max(0, width - safeVisibleWidth(body))) : "";
	return `${bgAnsi}${ERASE_LINE}${body}${bgAnsi}${fill}${RESET_BACKGROUND}`;
}

export function paintFrameBackgroundSegment(text: string, bgAnsi: string): string {
	return bgAnsi ? wrapAnsiBackground(text, bgAnsi) : text;
}

export function paintFrameBackgroundClears(text: string, bgAnsi: string): string {
	return bgAnsi ? String(text).replace(/\x1b\[2K/g, `${bgAnsi}${ERASE_LINE}`) : String(text);
}

export function paintFrameBackgroundLines(lines: readonly string[], bgAnsi: string, targetWidth = 0): string[] {
	return lines.map((line) => paintFrameBackgroundLine(line, bgAnsi, targetWidth));
}

export function padFrameRows(lines: readonly string[], minRows: number): string[] {
	const frameLines = lines.map((line) => String(line));
	while (frameLines.length < minRows) frameLines.push("");
	return frameLines;
}
