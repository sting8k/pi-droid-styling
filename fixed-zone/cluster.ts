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

function normalizeLine(line: string, width: number): string {
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "");
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

export function renderFixedUserZoneCluster(renderables: HiddenRenderable[], width: number, maxRows: number): FixedZoneCluster {
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

	if (maxRows <= 0 || lines.length <= maxRows) return { lines, cursor };

	const start = lines.length - maxRows;
	const visibleLines = lines.slice(start);
	const visibleCursor = cursor && cursor.row > start
		? { row: cursor.row - start, col: cursor.col }
		: undefined;
	return { lines: visibleLines, cursor: visibleCursor };
}
