import { safeVisibleWidth } from "../render-budget.js";

export type SelectionRegion = "root" | "sidebar" | "cluster";

export interface SelectionPoint {
	region: SelectionRegion;
	line: number;
	col: number;
}

export type SelectionSources = Record<SelectionRegion, readonly string[]>;

export type SelectionActivity = "drag" | "word" | "line";

type ColumnSpan = {
	char: string;
	index: number;
	startCol: number;
	endCol: number;
};

export const SELECTION_MULTI_CLICK_MS = 400;
const MULTI_CLICK_COL_TOLERANCE = 1;

export function stripAnsi(text: string): string {
	return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function sliceColumns(text: string, startCol: number, endCol: number): string {
	let col = 0;
	let result = "";
	for (const char of Array.from(text)) {
		const width = Math.max(0, safeVisibleWidth(char));
		if (col >= startCol && col < endCol) result += char;
		col += width;
	}
	return result;
}

export function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function clonePoint(point: SelectionPoint): SelectionPoint {
	return { region: point.region, line: point.line, col: point.col };
}

function sameClickTarget(a: SelectionPoint, b: SelectionPoint): boolean {
	return a.region === b.region && a.line === b.line && Math.abs(a.col - b.col) <= MULTI_CLICK_COL_TOLERANCE;
}

function visibleWidth(text: string): number {
	return safeVisibleWidth(stripAnsi(text));
}

function columnSpans(text: string): ColumnSpan[] {
	let col = 0;
	return Array.from(text).map((char, index) => {
		const startCol = col;
		col += Math.max(0, safeVisibleWidth(char));
		return { char, index, startCol, endCol: col };
	});
}

function columnSpanAt(spans: readonly ColumnSpan[], col: number): ColumnSpan | null {
	for (const span of spans) {
		if (col >= span.startCol && col < span.endCol) return span;
	}
	return null;
}

function isSelectableWordChar(char: string): boolean {
	return !/\s/u.test(char);
}

function normalizedRange(anchor: SelectionPoint | null, focus: SelectionPoint | null): { start: SelectionPoint; end: SelectionPoint } | null {
	if (!anchor || !focus || anchor.region !== focus.region) return null;
	const start = compareSelectionPoints(anchor, focus) <= 0 ? anchor : focus;
	const end = start === anchor ? focus : anchor;
	return { start, end };
}

export class FixedZoneSelection {
	private anchorPoint: SelectionPoint | null = null;
	private focusPoint: SelectionPoint | null = null;
	private activity: SelectionActivity | null = null;
	private lastClickAt = 0;
	private lastClickPoint: SelectionPoint | null = null;
	private clickCount = 0;

	get anchor(): SelectionPoint | null {
		return this.anchorPoint;
	}

	get focus(): SelectionPoint | null {
		return this.focusPoint;
	}

	get dragging(): boolean {
		return this.activity === "drag";
	}

	get activeRegion(): SelectionRegion | undefined {
		return this.activity && this.anchorPoint ? this.anchorPoint.region : undefined;
	}

	registerPress(point: SelectionPoint, now = Date.now()): number {
		if (this.lastClickPoint && sameClickTarget(this.lastClickPoint, point) && now - this.lastClickAt <= SELECTION_MULTI_CLICK_MS) {
			this.clickCount = Math.min(3, this.clickCount + 1);
		} else {
			this.clickCount = 1;
		}
		this.lastClickAt = now;
		this.lastClickPoint = clonePoint(point);
		return this.clickCount;
	}

	resetClickSequence(): void {
		this.lastClickAt = 0;
		this.lastClickPoint = null;
		this.clickCount = 0;
	}

	startDrag(point: SelectionPoint): void {
		this.anchorPoint = clonePoint(point);
		this.focusPoint = clonePoint(point);
		this.activity = "drag";
	}

	selectWord(point: SelectionPoint, sourceLines: readonly string[]): boolean {
		const line = stripAnsi(sourceLines[point.line] ?? "");
		const spans = columnSpans(line);
		const clicked = columnSpanAt(spans, point.col);
		if (!clicked || !isSelectableWordChar(clicked.char)) return false;

		let startIndex = clicked.index;
		let endIndex = clicked.index;
		while (startIndex > 0 && isSelectableWordChar(spans[startIndex - 1]?.char ?? "")) startIndex--;
		while (endIndex + 1 < spans.length && isSelectableWordChar(spans[endIndex + 1]?.char ?? "")) endIndex++;

		this.anchorPoint = { region: point.region, line: point.line, col: spans[startIndex]?.startCol ?? point.col };
		this.focusPoint = { region: point.region, line: point.line, col: spans[endIndex]?.endCol ?? point.col };
		this.activity = "word";
		return this.anchorPoint.col !== this.focusPoint.col;
	}

	selectLine(point: SelectionPoint, sourceLines: readonly string[]): boolean {
		const line = sourceLines[point.line];
		if (line === undefined) return false;
		this.anchorPoint = { region: point.region, line: point.line, col: 0 };
		this.focusPoint = { region: point.region, line: point.line, col: visibleWidth(line) };
		this.activity = "line";
		return true;
	}

	updateDrag(point: SelectionPoint): "updated" | "noop" | "ignored" {
		if (this.activity !== "drag" || this.anchorPoint?.region !== point.region) return "ignored";
		if (this.focusPoint && compareSelectionPoints(this.focusPoint, point) === 0) return "noop";
		this.focusPoint = clonePoint(point);
		return "updated";
	}

	finish(point: SelectionPoint | null): SelectionActivity | null {
		const finishedActivity = this.activity;
		if (!finishedActivity) return null;
		if (finishedActivity === "drag" && point && this.anchorPoint?.region === point.region) {
			this.focusPoint = clonePoint(point);
		}
		this.activity = null;
		return finishedActivity;
	}

	clear(): void {
		this.anchorPoint = null;
		this.focusPoint = null;
		this.activity = null;
	}

	cacheKey(region: SelectionRegion): string {
		if (!this.anchorPoint || !this.focusPoint || this.anchorPoint.region !== region || this.focusPoint.region !== region) return "none";
		return `${this.anchorPoint.line}:${this.anchorPoint.col}:${this.focusPoint.line}:${this.focusPoint.col}`;
	}

	getSelectedText(sources: SelectionSources): string {
		const range = normalizedRange(this.anchorPoint, this.focusPoint);
		if (!range) return "";
		const { start, end } = range;
		if (start.line === end.line && start.col === end.col) return "";
		const sourceLines = sources[start.region];
		const selected: string[] = [];
		for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
			const line = stripAnsi(sourceLines[lineIndex] ?? "");
			selected.push(sliceColumns(line, lineIndex === start.line ? start.col : 0, lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY));
		}
		return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
	}

	renderLineHighlight(region: SelectionRegion, line: string, lineIndex: number): string {
		const range = normalizedRange(this.anchorPoint, this.focusPoint);
		if (!range || range.start.region !== region) return line;
		const { start, end } = range;
		if (lineIndex < start.line || lineIndex > end.line) return line;
		const plain = stripAnsi(line);
		const lineWidth = safeVisibleWidth(plain);
		const startCol = lineIndex === start.line ? Math.max(0, Math.min(start.col, lineWidth)) : 0;
		const endCol = lineIndex === end.line ? Math.max(startCol, Math.min(end.col, lineWidth)) : lineWidth;
		if (startCol === endCol) return line;
		return `${sliceColumns(plain, 0, startCol)}\x1b[7m${sliceColumns(plain, startCol, endCol)}\x1b[27m${sliceColumns(plain, endCol, Number.POSITIVE_INFINITY)}`;
	}
}
