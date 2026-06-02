import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const MAX_RENDER_LINE_CHARS = 2000;
export const BOXED_RESULT_RENDERED_HEAD_LINES = 100;
export const BOXED_RESULT_RENDERED_TAIL_LINES = 10;
export const MAX_FIXED_ROOT_LINES = 2000;

const RENDER_TRUNCATION_SUFFIX = "… (truncated)";

export function clampRenderLine(line: string, maxChars = MAX_RENDER_LINE_CHARS): string {
	if (line.length <= maxChars) return line;
	return line.slice(0, maxChars) + RENDER_TRUNCATION_SUFFIX;
}

export function safeWrapTextWithAnsi(text: string, width: number, maxChars = MAX_RENDER_LINE_CHARS): string[] {
	return wrapTextWithAnsi(clampRenderLine(text, maxChars), width);
}

export function clampRenderedLines(
	lines: string[],
	headLines: number,
	tailLines: number,
	truncationLine: (remaining: number) => string,
): string[] {
	const safeHeadLines = Math.max(0, Math.floor(headLines));
	const safeTailLines = Math.max(0, Math.floor(tailLines));
	const maxVisibleLines = safeHeadLines + safeTailLines;
	if (maxVisibleLines <= 0 || lines.length <= maxVisibleLines) return lines;

	const head = lines.slice(0, safeHeadLines);
	const tail = safeTailLines > 0 ? lines.slice(lines.length - safeTailLines) : [];
	const remaining = lines.length - head.length - tail.length;
	return [...head, truncationLine(remaining), ...tail];
}
