// Shared ANSI helpers for the pi-neapple extension

import { visibleWidth } from "@mariozechner/pi-tui";

// Strip ANSI escape codes (pre-compiled regexes for performance)
const RE_CSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
const RE_OSC_HYPERLINK = /\x1b\]8;;[^\x07]*\x07/g;
const RE_APC = /\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(str: string): string {
	return str.replace(RE_CSI, "").replace(RE_OSC_HYPERLINK, "").replace(RE_APC, "");
}

// ------------------------------------------------------------
// Color helpers (truecolor + 256color fallback)
// ------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace("#", "");
	if (cleaned.length === 3) {
		const r = Number.parseInt(cleaned[0]! + cleaned[0], 16);
		const g = Number.parseInt(cleaned[1]! + cleaned[1], 16);
		const b = Number.parseInt(cleaned[2]! + cleaned[2], 16);
		return { r, g, b };
	}
	if (cleaned.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(cleaned)) {
		return { r: 0, g: 0, b: 0 };
	}
	const r = Number.parseInt(cleaned.slice(0, 2), 16);
	const g = Number.parseInt(cleaned.slice(2, 4), 16);
	const b = Number.parseInt(cleaned.slice(4, 6), 16);
	return { r, g, b };
}

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

function findClosestCubeIndex(value: number): number {
	let minDist = Number.POSITIVE_INFINITY;
	let minIdx = 0;
	for (let i = 0; i < CUBE_VALUES.length; i++) {
		const dist = Math.abs(value - CUBE_VALUES[i]!);
		if (dist < minDist) {
			minDist = dist;
			minIdx = i;
		}
	}
	return minIdx;
}

function findClosestGrayIndex(gray: number): number {
	let minDist = Number.POSITIVE_INFINITY;
	let minIdx = 0;
	for (let i = 0; i < GRAY_VALUES.length; i++) {
		const dist = Math.abs(gray - GRAY_VALUES[i]!);
		if (dist < minDist) {
			minDist = dist;
			minIdx = i;
		}
	}
	return minIdx;
}

function rgbTo256(r: number, g: number, b: number): number {
	const rIdx = findClosestCubeIndex(r);
	const gIdx = findClosestCubeIndex(g);
	const bIdx = findClosestCubeIndex(b);
	const cubeR = CUBE_VALUES[rIdx]!;
	const cubeG = CUBE_VALUES[gIdx]!;
	const cubeB = CUBE_VALUES[bIdx]!;
	const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);

	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIdx = findClosestGrayIndex(gray);
	const grayValue = GRAY_VALUES[grayIdx]!;
	const grayIndex = 232 + grayIdx;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);

	const spread = Math.max(r, g, b) - Math.min(r, g, b);
	if (spread < 10 && grayDist < cubeDist) {
		return grayIndex;
	}
	return cubeIndex;
}

const fgEscapeCache = new Map<string, string>();

function getFgEscape(theme: any, hex: string): { prefix: string; suffix: string } {
	const mode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : "truecolor";
	const cacheKey = `${mode}:${hex}`;
	let cached = fgEscapeCache.get(cacheKey);
	if (!cached) {
		const { r, g, b } = hexToRgb(hex);
		if (mode === "256color") {
			const idx = rgbTo256(r, g, b);
			cached = `\x1b[38;5;${idx}m`;
		} else {
			cached = `\x1b[38;2;${r};${g};${b}m`;
		}
		fgEscapeCache.set(cacheKey, cached);
	}
	return { prefix: cached, suffix: "\x1b[39m" };
}

export function fgHex(theme: any, hex: string, text: string): string {
	const { prefix, suffix } = getFgEscape(theme, hex);
	return `${prefix}${text}${suffix}`;
}

// ------------------------------------------------------------
// ANSI-aware text manipulation
// ------------------------------------------------------------

export function readAnsiToken(text: string, index: number): string | undefined {
	if (text[index] !== "\x1b") return undefined;
	const tail = text.slice(index);
	// CSI sequences: \x1b[...m (colors, cursor, etc.)
	const csi = tail.match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/)?.[0];
	if (csi) return csi;
	// OSC sequences: \x1b]...\x07 (hyperlinks, window title, etc.)
	const osc = tail.match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/)?.[0];
	return osc;
}

export function dropLeadingColumns(line: string, columns: number): string {
	if (columns <= 0 || line.length === 0) return line;

	let i = 0;
	let dropped = 0;
	let leadingAnsi = "";

	while (i < line.length && dropped < columns) {
		const ansi = readAnsiToken(line, i);
		if (ansi) {
			leadingAnsi += ansi;
			i += ansi.length;
			continue;
		}

		const codePoint = line.codePointAt(i);
		if (codePoint === undefined) break;
		const charLen = codePoint > 0xffff ? 2 : 1;
		const char = line.slice(i, i + charLen);
		i += charLen;
		dropped += Math.max(1, visibleWidth(char));
	}

	return `${leadingAnsi}${line.slice(i)}`;
}

export function startsWithVisibleSpace(line: string): boolean {
	if (!line) return false;

	let i = 0;
	while (i < line.length) {
		const ansi = readAnsiToken(line, i);
		if (ansi) {
			i += ansi.length;
			continue;
		}

		const codePoint = line.codePointAt(i);
		if (codePoint === undefined) return false;
		const charLen = codePoint > 0xffff ? 2 : 1;
		const char = line.slice(i, i + charLen);
		return char === " ";
	}

	return false;
}
