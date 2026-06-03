import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";

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

export interface FixedZoneClusterOptions {
	scrollHint?: string;
	hintRightInset?: number;
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
	return Math.max(cursorCol, safeVisibleWidth(line.replace(/\s+$/u, "")));
}

function appendRight(line: string, right: string, width: number, rightInset = DEFAULT_CONTENT_INSET): string {
	const rightWidth = safeVisibleWidth(right);
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	if (rightWidth + safeInset >= width) return line;
	const lineWidth = safeVisibleWidth(line);
	const leftWidth = width - safeInset - rightWidth;
	if (lineWidth > leftWidth) {
		return `${safeTruncateToWidth(line, leftWidth, "")}${right}${" ".repeat(safeInset)}`;
	}
	return `${line}${" ".repeat(leftWidth - lineWidth)}${right}${" ".repeat(safeInset)}`;
}

function scrollHintButton(label: string): string {
	return dim(`[${label}]`);
}

function applyScrollHintButton(lines: string[], cursor: FixedZoneCluster["cursor"], hint: string | undefined, width: number, rightInset = DEFAULT_CONTENT_INSET): FixedZoneCluster["cursor"] {
	if (!hint || !cursor) return cursor;
	const rowIndex = cursor.row - 1;
	const line = lines[rowIndex] ?? "";
	const right = scrollHintButton(hint);
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	if (occupiedLineWidth(line, cursor.col) + MIN_HINT_GAP + safeVisibleWidth(right) + safeInset > width) return cursor;
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

	cursor = applyScrollHintButton(lines, cursor, options.scrollHint, width, options.hintRightInset);

	if (maxRows <= 0 || lines.length <= maxRows) return { lines, cursor };

	const start = lines.length - maxRows;
	const visibleLines = lines.slice(start);
	const visibleCursor = cursor && cursor.row > start
		? { row: cursor.row - start, col: cursor.col }
		: undefined;
	return { lines: visibleLines, cursor: visibleCursor };
}
