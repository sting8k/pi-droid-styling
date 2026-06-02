import { truncateToWidth as tuiTruncateToWidth, visibleWidth as tuiVisibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { profileCount } from "./performance/profiler.js";

export const MAX_RENDER_LINE_CHARS = 2000;
export const DEFAULT_COLLAPSED_RENDER_LINES = 10;
export const MAX_BOXED_RESULT_RENDERED_HEAD_LINES = 40;
export const MAX_BOXED_RESULT_RENDERED_TAIL_LINES = 8;
export const MAX_BOXED_RESULT_RENDERED_LINES = 160;
export const MAX_FIXED_ROOT_LINES = 2000;

const RENDER_TRUNCATION_SUFFIX = "… (truncated)";
const TRUNCATE_ELLIPSIS = "…";
const ANSI_RESET = "\x1b[0m";
const SGR_PREFIX_PATTERN = /^(?:\x1b\[[0-9;]*m)+/;
const SGR_SUFFIX_PATTERN = /(?:\x1b\[[0-9;]*m)+$/;

type SimpleSgrWrappedText = {
	prefix: string;
	body: string;
	suffix: string;
	kind: "sgrAscii" | "sgrSimple";
};

type FastTextKind = "ascii" | "sgrAscii" | "simple" | "sgrSimple";

type FastTextWidth = {
	visibleWidth: number;
	kind: FastTextKind;
};

type FastTruncateResult = {
	text: string;
	visibleWidth: number;
	kind: FastTextKind;
};

export type FastBoxLineContent = {
	text: string;
	visibleWidth: number;
	kind: FastTextKind;
};

export type BoxedResultRenderBudget = {
	headLines: number;
	tailLines: number;
	maxRenderedLines: number;
};

export function clampRenderLine(line: string, maxChars = MAX_RENDER_LINE_CHARS): string {
	if (line.length <= maxChars) return line;
	return line.slice(0, maxChars) + RENDER_TRUNCATION_SUFFIX;
}

function isPrintableAsciiCode(code: number): boolean {
	return code >= 0x20 && code <= 0x7e;
}

function isSimpleWidthOneGlyphCode(code: number): boolean {
	if (code >= 0x2500 && code <= 0x257f) return true; // box drawing
	if (code >= 0x2580 && code <= 0x259f) return true; // block elements
	if (code >= 0x25a0 && code <= 0x25ff) return true; // geometric shapes used by UI status marks
	if (code >= 0x2800 && code <= 0x28ff) return true; // braille loader frames
	return (
		code === 0x00b2 || // ²
		code === 0x00b7 || // ·
		code === 0x03c0 || // π
		code === 0x2013 || // –
		code === 0x2014 || // —
		code === 0x2022 || // •
		code === 0x2026 || // …
		code === 0x2191 || // ↑
		code === 0x2192 || // →
		code === 0x2193 || // ↓
		code === 0x21b3 || // ↳
		code === 0x2205 || // ∅
		code === 0x2248 || // ≈
		code === 0x22ef || // ⋯
		code === 0x2387 || // ⎇
		code === 0x23f9 || // ⏹
		code === 0x270e || // ✎
		code === 0x2713 || // ✓
		code === 0x2717 || // ✗
		code === 0x276f || // ❯
		code === 0x2794 // ➔
	);
}

function isSimpleWidthOneCode(code: number): boolean {
	return isPrintableAsciiCode(code) || isSimpleWidthOneGlyphCode(code);
}

function fastKindCounter(prefix: string, kind: FastTextKind): string {
	if (kind === "ascii") return `${prefix}.fastAscii`;
	if (kind === "sgrAscii") return `${prefix}.fastSgrAscii`;
	if (kind === "simple") return `${prefix}.fastSimple`;
	return `${prefix}.fastSgrSimple`;
}

function breakLongAsciiWord(word: string, width: number): string[] {
	const lines: string[] = [];
	for (let i = 0; i < word.length; i += width) {
		lines.push(word.slice(i, i + width));
	}
	return lines.length > 0 ? lines : [""];
}

function wrapPrintableAsciiLine(line: string, width: number): string[] {
	if (!line) return [""];
	if (line.length <= width) return [line];

	const wrapped: string[] = [];
	let currentLine = "";
	let currentVisibleLength = 0;
	let tokenStart = 0;

	while (tokenStart < line.length) {
		const tokenIsSpace = line[tokenStart] === " ";
		let tokenEnd = tokenStart + 1;
		while (tokenEnd < line.length && (line[tokenEnd] === " ") === tokenIsSpace) tokenEnd++;

		const token = line.slice(tokenStart, tokenEnd);
		const tokenVisibleLength = token.length;
		if (tokenVisibleLength > width && !tokenIsSpace) {
			if (currentLine) {
				wrapped.push(currentLine.trimEnd());
				currentLine = "";
				currentVisibleLength = 0;
			}
			const broken = breakLongAsciiWord(token, width);
			wrapped.push(...broken.slice(0, -1));
			currentLine = broken[broken.length - 1] ?? "";
			currentVisibleLength = currentLine.length;
			tokenStart = tokenEnd;
			continue;
		}

		const totalNeeded = currentVisibleLength + tokenVisibleLength;
		if (totalNeeded > width && currentVisibleLength > 0) {
			wrapped.push(currentLine.trimEnd());
			if (tokenIsSpace) {
				currentLine = "";
				currentVisibleLength = 0;
			} else {
				currentLine = token;
				currentVisibleLength = tokenVisibleLength;
			}
		} else {
			currentLine += token;
			currentVisibleLength += tokenVisibleLength;
		}

		tokenStart = tokenEnd;
	}

	if (currentLine) wrapped.push(currentLine);
	return wrapped.length > 0 ? wrapped.map((wrappedLine) => wrappedLine.trimEnd()) : [""];
}

function matchSimpleSgrWrappedText(text: string): SimpleSgrWrappedText | null {
	const prefixMatch = SGR_PREFIX_PATTERN.exec(text);
	const suffixMatch = SGR_SUFFIX_PATTERN.exec(text);
	if (!prefixMatch || !suffixMatch) return null;
	const prefix = prefixMatch[0];
	const suffix = suffixMatch[0];
	const bodyStart = prefix.length;
	const bodyEnd = suffixMatch.index;
	if (bodyEnd < bodyStart) return null;

	const body = text.slice(bodyStart, bodyEnd);
	const bodyWidth = knownVisibleWidth(body);
	if (!bodyWidth || bodyWidth.kind === "sgrAscii" || bodyWidth.kind === "sgrSimple") return null;
	return { prefix, body, suffix, kind: bodyWidth.kind === "ascii" ? "sgrAscii" : "sgrSimple" };
}

function wrapSimpleSgrWrappedText(text: string, width: number): { lines: string[]; kind: "sgrAscii" | "sgrSimple" } | null {
	const match = matchSimpleSgrWrappedText(text);
	if (!match) return null;
	return {
		lines: wrapPrintableAsciiLine(match.body, width).map((line) => `${match.prefix}${line}${match.suffix}`),
		kind: match.kind,
	};
}

function readSgrSequenceEnd(text: string, offset: number): number {
	if (text.charCodeAt(offset) !== 0x1b || text[offset + 1] !== "[") return -1;
	let cursor = offset + 2;
	while (cursor < text.length) {
		const code = text.charCodeAt(cursor);
		if (code === 0x6d) return cursor + 1; // m
		if (code !== 0x3b && (code < 0x30 || code > 0x39)) return -1; // ; or 0-9
		cursor++;
	}
	return -1;
}

function knownVisibleWidth(text: string): FastTextWidth | null {
	let width = 0;
	let sawSgr = false;
	let sawSimpleGlyph = false;
	for (let i = 0; i < text.length;) {
		const sgrEnd = readSgrSequenceEnd(text, i);
		if (sgrEnd > i) {
			sawSgr = true;
			i = sgrEnd;
			continue;
		}
		const code = text.charCodeAt(i);
		if (!isSimpleWidthOneCode(code)) return null;
		if (!isPrintableAsciiCode(code)) sawSimpleGlyph = true;
		width++;
		i++;
	}
	if (sawSgr) return { visibleWidth: width, kind: sawSimpleGlyph ? "sgrSimple" : "sgrAscii" };
	return { visibleWidth: width, kind: sawSimpleGlyph ? "simple" : "ascii" };
}

function knownEllipsisWidth(text: string): number | null {
	if (text === TRUNCATE_ELLIPSIS) return 1;
	return knownVisibleWidth(text)?.visibleWidth ?? null;
}

function truncatePrintableAscii(text: string, width: number, ellipsis = TRUNCATE_ELLIPSIS): { text: string; visibleWidth: number } {
	if (width <= 0) return { text: "", visibleWidth: 0 };
	if (text.length <= width) return { text, visibleWidth: text.length };
	const ellipsisWidth = knownEllipsisWidth(ellipsis);
	if (ellipsisWidth === null) return { text: text.slice(0, width), visibleWidth: width };
	if (ellipsisWidth >= width) {
		if (ellipsis === TRUNCATE_ELLIPSIS) return { text: TRUNCATE_ELLIPSIS, visibleWidth: 1 };
		return { text: ellipsis.slice(0, width), visibleWidth: Math.min(width, ellipsis.length) };
	}
	const targetWidth = Math.max(0, width - ellipsisWidth);
	return { text: `${text.slice(0, targetWidth)}${ellipsis}`, visibleWidth: targetWidth + ellipsisWidth };
}

function truncateSgrAscii(text: string, width: number, ellipsis: string, visibleWidth: number): { text: string; visibleWidth: number } | null {
	if (visibleWidth <= width) return { text, visibleWidth };
	const ellipsisWidth = knownEllipsisWidth(ellipsis);
	if (ellipsisWidth === null) return null;
	if (ellipsisWidth >= width) return truncatePrintableAscii(ellipsis, width, "");

	const targetWidth = Math.max(0, width - ellipsisWidth);
	let keptWidth = 0;
	let output = "";
	for (let i = 0; i < text.length && keptWidth < targetWidth;) {
		const sgrEnd = readSgrSequenceEnd(text, i);
		if (sgrEnd > i) {
			output += text.slice(i, sgrEnd);
			i = sgrEnd;
			continue;
		}
		const code = text.charCodeAt(i);
		if (!isSimpleWidthOneCode(code)) return null;
		output += text[i] ?? "";
		keptWidth++;
		i++;
	}
	return { text: `${output}${ANSI_RESET}${ellipsis}${ANSI_RESET}`, visibleWidth: keptWidth + ellipsisWidth };
}

function fastTruncateText(text: string, width: number, ellipsis = TRUNCATE_ELLIPSIS): FastTruncateResult | null {
	const knownWidth = knownVisibleWidth(text);
	if (!knownWidth) return null;
	if (knownWidth.kind === "ascii" || knownWidth.kind === "simple") return { ...truncatePrintableAscii(text, width, ellipsis), kind: knownWidth.kind };

	const simple = matchSimpleSgrWrappedText(text);
	if (simple) {
		const truncated = truncatePrintableAscii(simple.body, width, ellipsis);
		return { text: `${simple.prefix}${truncated.text}${simple.suffix}`, visibleWidth: truncated.visibleWidth, kind: simple.kind };
	}

	const truncated = truncateSgrAscii(text, width, ellipsis, knownWidth.visibleWidth);
	return truncated ? { ...truncated, kind: knownWidth.kind } : null;
}

export function safeVisibleWidth(text: string): number {
	const fastWidth = knownVisibleWidth(text);
	if (fastWidth) {
		profileCount(fastKindCounter("safeVisible", fastWidth.kind));
		return fastWidth.visibleWidth;
	}
	if (text === TRUNCATE_ELLIPSIS) {
		profileCount("safeVisible.fastAscii");
		return 1;
	}
	profileCount("safeVisible.fallback");
	return tuiVisibleWidth(text);
}

export function safeTruncateToWidth(text: string, maxWidth: number, ellipsis = "...", pad = false): string {
	const width = Math.floor(maxWidth);
	if (!Number.isFinite(width) || width <= 0) return "";
	if (text.length === 0) return pad ? " ".repeat(width) : "";

	const truncated = fastTruncateText(text, width, ellipsis);
	if (truncated) {
		profileCount(fastKindCounter("safeTruncate", truncated.kind));
		return pad ? `${truncated.text}${" ".repeat(Math.max(0, width - truncated.visibleWidth))}` : truncated.text;
	}

	profileCount("safeTruncate.fallback");
	return tuiTruncateToWidth(text, maxWidth, ellipsis, pad);
}

export function fastBoxLineContent(content: string, width: number): FastBoxLineContent | null {
	const contentWidth = Math.floor(width);
	if (!Number.isFinite(contentWidth) || contentWidth <= 0) return null;

	return fastTruncateText(content, contentWidth);
}

export function safeWrapTextWithAnsi(text: string, width: number, maxChars = MAX_RENDER_LINE_CHARS): string[] {
	const clamped = clampRenderLine(text, maxChars);
	const wrapWidth = Math.floor(width);
	if (!Number.isFinite(wrapWidth) || wrapWidth <= 0) {
		profileCount("safeWrap.fallback");
		return wrapTextWithAnsi(clamped, width);
	}
	const clampedWidth = knownVisibleWidth(clamped);
	if (clampedWidth?.kind === "ascii" || clampedWidth?.kind === "simple") {
		profileCount(fastKindCounter("safeWrap", clampedWidth.kind));
		return wrapPrintableAsciiLine(clamped, wrapWidth);
	}
	const simpleSgrWrapped = wrapSimpleSgrWrappedText(clamped, wrapWidth);
	if (simpleSgrWrapped) {
		profileCount(fastKindCounter("safeWrap", simpleSgrWrapped.kind));
		return simpleSgrWrapped.lines;
	}
	profileCount("safeWrap.fallback");
	return wrapTextWithAnsi(clamped, width);
}

export function boxedResultRenderBudget(rawLineBudget: number = DEFAULT_COLLAPSED_RENDER_LINES): BoxedResultRenderBudget {
	const rawLines = Math.max(0, Math.floor(Number.isFinite(rawLineBudget) ? rawLineBudget : DEFAULT_COLLAPSED_RENDER_LINES));
	const maxRenderedLines = Math.max(1, Math.min(rawLines * 3, MAX_BOXED_RESULT_RENDERED_LINES));
	const tailLines = Math.min(
		Math.ceil(rawLines * 0.15),
		MAX_BOXED_RESULT_RENDERED_TAIL_LINES,
		Math.max(0, maxRenderedLines - 1),
	);
	const headLines = Math.min(
		rawLines,
		MAX_BOXED_RESULT_RENDERED_HEAD_LINES,
		Math.max(1, maxRenderedLines - tailLines - 1),
	);

	return { headLines, tailLines, maxRenderedLines };
}
