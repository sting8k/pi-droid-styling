import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";

export interface RenderableLike {
	render(width: number): string[];
}

export interface HiddenRenderable {
	target: RenderableLike;
	render(width: number): string[];
}

export interface FixedZoneCluster {
	lines: string[];
	cursor?: {
		row: number;
		col: number;
	};
}

export type FixedZoneScrollHintPlacement = "cursor" | "lastLine";

export interface FixedZoneClusterOptions {
	scrollHint?: string;
	hintRightInset?: number;
	scrollHintPlacement?: FixedZoneScrollHintPlacement;
}

const DIM_START = "\x1b[2m";
const DIM_END = "\x1b[22m";
const DEFAULT_CONTENT_INSET = 2;
const MIN_HINT_GAP = 2;

function normalizeLine(line: string, width: number): string {
	if (safeVisibleWidth(line) <= width) return line;
	return safeTruncateToWidth(line, width, "");
}

function dim(text: string): string {
	return `${DIM_START}${text}${DIM_END}`;
}

function occupiedLineWidth(line: string, cursorCol: number): number {
	return Math.max(cursorCol, safeVisibleWidth(stripAnsi(line).replace(/\s+$/u, "")));
}

function appendRight(line: string, right: string, width: number, rightInset = DEFAULT_CONTENT_INSET): string {
	const rightWidth = safeVisibleWidth(right);
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	if (rightWidth + safeInset >= width) return line;
	const lineWidth = safeVisibleWidth(line);
	const leftWidth = width - safeInset - rightWidth;
	if (lineWidth > leftWidth) {
		return `${safeTruncateToWidth(line, leftWidth, "")}\x1b[49m${" ".repeat(leftWidth - safeVisibleWidth(safeTruncateToWidth(line, leftWidth, "")))}${right}${" ".repeat(safeInset)}`;
	}
	return `${line}\x1b[49m${" ".repeat(leftWidth - lineWidth)}${right}${" ".repeat(safeInset)}`;
}

function shrinkLargestSpaceRun(text: string, removeWidth: number): { text: string; removed: number } {
	if (removeWidth <= 0) return { text, removed: 0 };
	let bestStart = -1;
	let bestLength = 0;
	const regex = / {2,}/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text))) {
		const length = match[0].length;
		if (length > bestLength) {
			bestStart = match.index;
			bestLength = length;
		}
	}
	if (bestStart < 0 || bestLength <= 1) return { text, removed: 0 };
	const removed = Math.min(removeWidth, bestLength - 1);
	return {
		text: `${text.slice(0, bestStart)}${" ".repeat(bestLength - removed)}${text.slice(bestStart + bestLength)}`,
		removed,
	};
}

function appendAfterContent(line: string, right: string, width: number, rightInset = DEFAULT_CONTENT_INSET): string {
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	const suffix = `${" ".repeat(MIN_HINT_GAP)}${right}${" ".repeat(safeInset)}`;
	const base = line.replace(/\s+$/u, "");
	if (!/ {2,}/.test(stripAnsi(base))) return appendRight(line, right, width, rightInset);
	const overflow = safeVisibleWidth(base) + safeVisibleWidth(suffix) - width;
	const { text: compactBase, removed } = shrinkLargestSpaceRun(base, overflow);
	if (overflow > 0 && removed < overflow) return line;
	const combined = `${compactBase}${suffix}`;
	return safeVisibleWidth(combined) > width ? safeTruncateToWidth(combined, width, "") : combined;
}

function scrollHintButton(label: string): string {
	return dim(`[${label}]`);
}

function applyScrollHintButton(
	lines: string[],
	cursor: FixedZoneCluster["cursor"],
	hint: string | undefined,
	width: number,
	rightInset = DEFAULT_CONTENT_INSET,
	placement: FixedZoneScrollHintPlacement = "cursor",
): FixedZoneCluster["cursor"] {
	if (!hint) return cursor;
	const rowIndex = placement === "lastLine" ? lines.length - 1 : (cursor ? cursor.row - 1 : -1);
	if (rowIndex < 0) return cursor;
	const line = lines[rowIndex] ?? "";
	const right = scrollHintButton(hint);
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	if (placement === "lastLine") {
		lines[rowIndex] = appendAfterContent(line, right, width, rightInset);
		return cursor;
	}
	const occupiedWidth = occupiedLineWidth(line, placement === "cursor" && cursor ? cursor.col : 0);
	if (occupiedWidth + MIN_HINT_GAP + safeVisibleWidth(right) + safeInset > width) return cursor;
	lines[rowIndex] = appendRight(line, right, width, rightInset);
	return cursor;
}

function stripCursorMarker(line: string, row: number): { line: string; cursor?: { row: number; col: number } } {
	const markerIndex = line.indexOf(CURSOR_MARKER);
	if (markerIndex === -1) return { line };
	const beforeMarker = line.slice(0, markerIndex);
	return {
		line: line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length),
		cursor: {
			row,
			col: safeVisibleWidth(beforeMarker) + 1,
		},
	};
}

export function renderFixedUserZoneCluster(renderables: HiddenRenderable[], width: number, maxRows: number, options: FixedZoneClusterOptions = {}): FixedZoneCluster {
	const lines: string[] = [];
	let cursor: FixedZoneCluster["cursor"];
	for (const renderable of renderables) {
		const rendered = renderable.render(width);
		for (const rawLine of rendered) {
			const markerResult = stripCursorMarker(rawLine, lines.length + 1);
			if (markerResult.cursor) cursor = markerResult.cursor;
			lines.push(normalizeLine(markerResult.line, width));
		}
	}

	cursor = applyScrollHintButton(lines, cursor, options.scrollHint, width, options.hintRightInset, options.scrollHintPlacement);

	if (maxRows <= 0 || lines.length <= maxRows) return { lines, cursor };

	const start = lines.length - maxRows;
	const visibleLines = lines.slice(start);
	const visibleCursor = cursor && cursor.row > start
		? { row: cursor.row - start, col: cursor.col }
		: undefined;
	return { lines: visibleLines, cursor: visibleCursor };
}
