import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
	showScrollDivider?: boolean;
	hintRightInset?: number;
	dividerInset?: number;
}

const DIM_START = "\x1b[2m";
const DIM_END = "\x1b[22m";
const DEFAULT_CONTENT_INSET = 2;

function scrollDividerLine(width: number, inset = DEFAULT_CONTENT_INSET): string {
	const side = " ".repeat(Math.max(0, Math.min(inset, Math.floor((width - 1) / 2))));
	const dividerWidth = Math.max(1, width - visibleWidth(side) * 2);
	return `${side}${DIM_START}${"┄".repeat(dividerWidth)}${DIM_END}${side}`;
}

function normalizeLine(line: string, width: number): string {
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "");
}

function dim(text: string): string {
	return `${DIM_START}${text}${DIM_END}`;
}

function appendRight(line: string, right: string, width: number, rightInset = DEFAULT_CONTENT_INSET): string {
	const rightWidth = visibleWidth(right);
	const safeInset = Math.max(0, Math.min(rightInset, Math.floor((width - 1) / 2)));
	if (rightWidth + safeInset >= width) return line;
	const lineWidth = visibleWidth(line);
	const leftWidth = width - safeInset - rightWidth;
	if (lineWidth > leftWidth) {
		return `${truncateToWidth(line, leftWidth, "")}${right}${" ".repeat(safeInset)}`;
	}
	return `${line}${" ".repeat(leftWidth - lineWidth)}${right}${" ".repeat(safeInset)}`;
}

function scrollHintButton(label: string): string {
	return dim(`[${label}]`);
}

function applyScrollHintButton(lines: string[], cursor: FixedZoneCluster["cursor"], hint: string | undefined, width: number, rightInset = DEFAULT_CONTENT_INSET): FixedZoneCluster["cursor"] {
	if (!hint || !cursor) return cursor;
	const rowIndex = cursor.row - 1;
	lines[rowIndex] = appendRight(lines[rowIndex] ?? "", scrollHintButton(hint), width, rightInset);
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
			col: visibleWidth(beforeMarker) + 1,
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

	if (options.showScrollDivider) {
		lines.unshift(normalizeLine(scrollDividerLine(width, options.dividerInset), width));
		if (cursor) cursor = { ...cursor, row: cursor.row + 1 };
	}

	if (maxRows <= 0 || lines.length <= maxRows) return { lines, cursor };

	const start = lines.length - maxRows;
	const visibleLines = lines.slice(start);
	const visibleCursor = cursor && cursor.row > start
		? { row: cursor.row - start, col: cursor.col }
		: undefined;
	return { lines: visibleLines, cursor: visibleCursor };
}
