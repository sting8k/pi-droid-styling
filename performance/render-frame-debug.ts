import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PATCHED = Symbol.for("pi-droid-styling.render-frame-debug.patched");
const FRAME_COUNTER = Symbol.for("pi-droid-styling.render-frame-debug.frame");
const PHYSICAL_SYNC_DEBUG_EVENTS = Symbol.for("pi-droid-styling.render-physical-sync.debug-events");
const DEBUG_MARKER_STATE = Symbol.for("pi-droid-styling.render-frame-debug.marker-state");
const DEBUG_MARKER_HANDLER_INSTALLED = Symbol.for("pi-droid-styling.render-frame-debug.marker-handler-installed");
const DEFAULT_MAX_TEXT_BYTES = 120_000;
const DEFAULT_CONTEXT_LINES = 8;

type AnyTui = {
	doRender?: (...args: unknown[]) => unknown;
	render?: (width: number) => string[];
	terminal?: { write?: (data: string) => unknown; columns?: number; rows?: number };
	previousLines?: unknown;
	previousViewportTop?: unknown;
	previousWidth?: unknown;
	previousHeight?: unknown;
	hardwareCursorRow?: unknown;
	cursorRow?: unknown;
	maxLinesRendered?: unknown;
	overlayStack?: unknown;
	[PATCHED]?: boolean;
	[FRAME_COUNTER]?: number;
	[PHYSICAL_SYNC_DEBUG_EVENTS]?: unknown;
};

type DebugMarkerState = {
	logPath: string;
	frame: number;
	count: number;
};

type DebugMarkerProcess = {
	[DEBUG_MARKER_STATE]?: DebugMarkerState;
	[DEBUG_MARKER_HANDLER_INSTALLED]?: boolean;
};

type RenderState = {
	previousLinesLength: number;
	previousViewportTop: number;
	previousWidth: number;
	previousHeight: number;
	hardwareCursorRow: number;
	cursorRow: number;
	maxLinesRendered: number;
	terminalColumns: number;
	terminalRows: number;
	overlayCount: number;
};

type CapturedRender = {
	width: number;
	lineCount: number;
	viewportSample: LineSample[];
	duplicateRuns: DuplicateRun[];
};

type LineSample = {
	index: number;
	text: string;
	plain: string;
};

type DuplicateRun = {
	first: number;
	second: number;
	plain: string;
};

type RowRange = {
	start: number;
	end: number;
};

type RowCoverage = {
	height: number;
	columns: number;
	initialRow: number;
	finalRow: number;
	expectedRows: number[];
	touchedRows: number[];
	missedRows: number[];
	expectedRanges: RowRange[];
	touchedRanges: RowRange[];
	missedRanges: RowRange[];
	textRows: number[];
	clearRows: number[];
	cursorRowMoves: number;
	wrapAdvances: number;
	scrollEvents: number;
	clearScreen: boolean;
};

type TerminalParseState = {
	row: number;
	col: number;
	savedRow: number;
	savedCol: number;
	height: number;
	columns: number;
	autowrap: boolean;
	pendingWrap: boolean;
	cursorRowMoves: number;
	wrapAdvances: number;
	scrollEvents: number;
	clearScreen: boolean;
};

type ScreenSimulationState = TerminalParseState & {
	rows: string[];
	viewportTop: number;
};

type ScreenSimulationSummary = {
	height: number;
	columns: number;
	viewportTop: number;
	resynced: string | undefined;
	comparedRows: number;
	mismatchRows: number[];
	mismatchRanges: RowRange[];
	mismatchSample: Array<{ row: number; expected: string; actual: string }>;
	cursorRow: number;
	cursorCol: number;
	wrapAdvances: number;
	scrollEvents: number;
	clearScreen: boolean;
};

export function installRenderFrameDebug(tui: AnyTui): void {
	if (process.env.PI_DROID_RENDER_DEBUG !== "1") return;
	if (!tui || tui[PATCHED] || typeof tui.doRender !== "function" || typeof tui.render !== "function") return;
	const terminal = tui.terminal;
	if (!terminal || typeof terminal.write !== "function") return;

	const originalDoRender = tui.doRender.bind(tui);
	const logPath = getLogPath();
	const markerState = installDebugMarker(logPath);
	let screenSimulation: ScreenSimulationState | undefined;
	tui[PATCHED] = true;
	tui[FRAME_COUNTER] = 0;
	writeJsonLine(logPath, {
		type: "session",
		pid: process.pid,
		startedAt: new Date().toISOString(),
	});

	tui.doRender = function frameLoggedDoRender(...args: unknown[]): unknown {
		const frame = ((tui[FRAME_COUNTER] ?? 0) as number) + 1;
		tui[FRAME_COUNTER] = frame;
		markerState.frame = frame;
		const startedAt = Date.now();
		const before = readRenderState(tui);
		const previousLines = readStringLines(tui.previousLines);
		const writes: string[] = [];
		const capturedRenders: CapturedRender[] = [];
		const activeWrite = terminal.write;
		const activeRender = tui.render;
		if (typeof activeWrite !== "function" || typeof activeRender !== "function") return originalDoRender(...args);

		terminal.write = function capturedWrite(this: unknown, data: string): unknown {
			writes.push(String(data));
			return activeWrite.call(this, data);
		};
		tui.render = function capturedRender(this: unknown, width: number): string[] {
			const lines = activeRender.call(this, width);
			capturedRenders.push({
				width,
				lineCount: lines.length,
				viewportSample: sampleViewport(lines, readNumber(tui.previousViewportTop), readNumber(tui.previousHeight)),
				duplicateRuns: collectAdjacentDuplicates(lines, readNumber(tui.previousViewportTop), readNumber(tui.previousHeight)),
			});
			return lines;
		};

		let error: unknown;
		try {
			return originalDoRender(...args);
		} catch (caught) {
			error = caught;
			throw caught;
		} finally {
			terminal.write = activeWrite;
			tui.render = activeRender;
			const after = readRenderState(tui);
			const nextLines = readStringLines(tui.previousLines);
			const changed = summarizeLineChanges(previousLines, nextLines);
			const viewportStart = Math.max(0, after.previousViewportTop);
			const rowCoverage = summarizeRowCoverage(writes, before, after, changed);
			const screenSimulationResult = summarizeScreenSimulation(writes, previousLines, nextLines, before, after, screenSimulation);
			screenSimulation = screenSimulationResult.state;
			writeJsonLine(logPath, {
				type: "frame",
				frame,
				startedAt,
				durationMs: Date.now() - startedAt,
				before,
				after,
				changed,
				viewportMoved: after.previousViewportTop !== before.previousViewportTop,
				viewportSample: sampleViewport(nextLines, viewportStart, after.previousHeight),
				duplicateRuns: collectAdjacentDuplicates(nextLines, viewportStart, after.previousHeight),
				capturedRenders,
				writes: summarizeWrites(writes),
				rowCoverage,
				screenSimulation: screenSimulationResult.summary,
				physicalSync: summarizePhysicalSyncDebug(tui),
				error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error === undefined ? undefined : String(error),
			});
		}
	};
}

function getLogPath(): string {
	const debugDir = process.env.PI_DROID_RENDER_DEBUG_DIR || join(tmpdir(), "pi-droid-render-debug");
	mkdirSync(debugDir, { recursive: true });
	return join(debugDir, `render-frame-${process.pid}.jsonl`);
}

function writeJsonLine(path: string, value: unknown): void {
	try {
		appendFileSync(path, `${JSON.stringify(value)}\n`);
	} catch {
		// Debug instrumentation must not affect rendering.
	}
}

function readRenderState(tui: AnyTui): RenderState {
	return {
		previousLinesLength: readStringLines(tui.previousLines).length,
		previousViewportTop: readNumber(tui.previousViewportTop),
		previousWidth: readNumber(tui.previousWidth),
		previousHeight: readNumber(tui.previousHeight),
		hardwareCursorRow: readNumber(tui.hardwareCursorRow),
		cursorRow: readNumber(tui.cursorRow),
		maxLinesRendered: readNumber(tui.maxLinesRendered),
		terminalColumns: readNumber(tui.terminal?.columns),
		terminalRows: readNumber(tui.terminal?.rows),
		overlayCount: Array.isArray(tui.overlayStack) ? tui.overlayStack.length : 0,
	};
}

function readNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function readStringLines(value: unknown): string[] {
	return Array.isArray(value) ? value.map((line) => String(line)) : [];
}

function summarizeLineChanges(previousLines: string[], nextLines: string[]) {
	let firstChanged = -1;
	let lastChanged = -1;
	const max = Math.max(previousLines.length, nextLines.length);
	for (let index = 0; index < max; index++) {
		if ((previousLines[index] ?? "") === (nextLines[index] ?? "")) continue;
		if (firstChanged === -1) firstChanged = index;
		lastChanged = index;
	}
	return {
		previousLineCount: previousLines.length,
		nextLineCount: nextLines.length,
		appended: nextLines.length > previousLines.length,
		deleted: nextLines.length < previousLines.length,
		firstChanged,
		lastChanged,
		changedSample: firstChanged >= 0 ? sampleLines(nextLines, Math.max(0, firstChanged - DEFAULT_CONTEXT_LINES), DEFAULT_CONTEXT_LINES * 2 + 1) : [],
	};
}

function sampleViewport(lines: readonly string[], viewportTop: number, height: number): LineSample[] {
	const safeHeight = Math.max(1, height || DEFAULT_CONTEXT_LINES * 2);
	const start = Math.max(0, viewportTop - DEFAULT_CONTEXT_LINES);
	const count = Math.min(lines.length - start, safeHeight + DEFAULT_CONTEXT_LINES * 2);
	return sampleLines(lines, start, count);
}

function sampleLines(lines: readonly string[], start: number, count: number): LineSample[] {
	const samples: LineSample[] = [];
	const end = Math.min(lines.length, start + Math.max(0, count));
	for (let index = Math.max(0, start); index < end; index++) {
		const text = truncateText(lines[index] ?? "", 800);
		samples.push({ index, text, plain: truncateText(stripAnsi(text), 800) });
	}
	return samples;
}

function collectAdjacentDuplicates(lines: readonly string[], viewportTop: number, height: number): DuplicateRun[] {
	const runs: DuplicateRun[] = [];
	const start = Math.max(1, viewportTop - DEFAULT_CONTEXT_LINES);
	const end = Math.min(lines.length, Math.max(start, viewportTop + Math.max(1, height) + DEFAULT_CONTEXT_LINES));
	for (let index = start; index < end; index++) {
		const previous = normalizeComparableLine(lines[index - 1] ?? "");
		const current = normalizeComparableLine(lines[index] ?? "");
		if (!current || current !== previous) continue;
		runs.push({ first: index - 1, second: index, plain: truncateText(current, 800) });
		if (runs.length >= 12) break;
	}
	return runs;
}

function normalizeComparableLine(line: string): string {
	return stripAnsi(line).replace(/[ \t]+$/g, "").trim();
}
function summarizeRowCoverage(writes: readonly string[], before: RenderState, after: RenderState, changed: ReturnType<typeof summarizeLineChanges>): RowCoverage {
	const height = Math.max(1, after.previousHeight || after.terminalRows || before.previousHeight || before.terminalRows || 1);
	const columns = Math.max(1, after.terminalColumns || before.terminalColumns || 1);
	const initialRow = clamp(before.hardwareCursorRow - before.previousViewportTop + 1, 1, height);
	const state: TerminalParseState = {
		row: initialRow,
		col: 1,
		savedRow: initialRow,
		savedCol: 1,
		height,
		columns,
		autowrap: true,
		pendingWrap: false,
		cursorRowMoves: 0,
		wrapAdvances: 0,
		scrollEvents: 0,
		clearScreen: false,
	};

	const touchedRows = new Set<number>();
	const textRows = new Set<number>();
	const clearRows = new Set<number>();
	for (const write of writes) parseTouchedRows(write, state, touchedRows, textRows, clearRows);

	const expectedRows = computeExpectedRows(before, after, changed, height);
	const touchedRowList = sortedRows(touchedRows);
	const missedRows = expectedRows.filter((row) => !touchedRows.has(row));
	return {
		height,
		columns,
		initialRow,
		finalRow: state.row,
		expectedRows,
		touchedRows: touchedRowList,
		missedRows,
		expectedRanges: rowsToRanges(expectedRows),
		touchedRanges: rowsToRanges(touchedRowList),
		missedRanges: rowsToRanges(missedRows),
		textRows: sortedRows(textRows),
		clearRows: sortedRows(clearRows),
		cursorRowMoves: state.cursorRowMoves,
		wrapAdvances: state.wrapAdvances,
		scrollEvents: state.scrollEvents,
		clearScreen: state.clearScreen,
	};
}

function computeExpectedRows(before: RenderState, after: RenderState, changed: ReturnType<typeof summarizeLineChanges>, height: number): number[] {
	const viewportRemapped = before.previousViewportTop !== after.previousViewportTop || before.previousHeight !== after.previousHeight;
	if (viewportRemapped) return rangeRows(1, height);
	if (changed.firstChanged < 0) return [];

	const viewportTop = Math.max(0, after.previousViewportTop);
	const visibleStart = viewportTop;
	const visibleEnd = viewportTop + height - 1;
	const lineCountChanged = changed.previousLineCount !== changed.nextLineCount;
	const shiftsExistingRows = changed.deleted || (lineCountChanged && changed.firstChanged < changed.previousLineCount);
	const firstLine = Math.max(visibleStart, changed.firstChanged);
	const lastLine = Math.min(visibleEnd, shiftsExistingRows ? visibleEnd : changed.lastChanged);
	if (firstLine > visibleEnd || lastLine < visibleStart || firstLine > lastLine) return [];
	return rangeRows(firstLine - viewportTop + 1, lastLine - viewportTop + 1);
}

function parseTouchedRows(text: string, state: TerminalParseState, touchedRows: Set<number>, textRows: Set<number>, clearRows: Set<number>): void {
	for (let index = 0; index < text.length;) {
		const code = text.charCodeAt(index);
		if (code === 0x1b) {
			index = parseEscape(text, index, state, touchedRows, clearRows);
			continue;
		}
		if (code === 0x0d) {
			state.col = 1;
			state.pendingWrap = false;
			index++;
			continue;
		}
		if (code === 0x0a) {
			lineFeed(state, touchedRows);
			index++;
			continue;
		}
		if (code >= 0x20 && code !== 0x7f) {
			writePrintable(text, index, state, touchedRows, textRows);
			index += text.codePointAt(index)! > 0xffff ? 2 : 1;
			continue;
		}
		index++;
	}
}

function parseEscape(text: string, index: number, state: TerminalParseState, touchedRows: Set<number>, clearRows: Set<number>): number {
	const next = text[index + 1];
	if (next === "[") return parseCsi(text, index + 2, state, touchedRows, clearRows);
	if (next === "]") return skipUntilStringTerminator(text, index + 2);
	if (next === "P" || next === "_" || next === "^" || next === "X") return skipUntilStringTerminator(text, index + 2);
	if (next === "s") {
		state.savedRow = state.row;
		state.savedCol = state.col;
		state.pendingWrap = false;
		return index + 2;
	}
	if (next === "u") {
		state.row = state.savedRow;
		state.col = state.savedCol;
		state.pendingWrap = false;
		return index + 2;
	}
	return Math.min(text.length, index + 2);
}

function parseCsi(text: string, index: number, state: TerminalParseState, touchedRows: Set<number>, clearRows: Set<number>): number {
	let end = index;
	while (end < text.length) {
		const code = text.charCodeAt(end);
		if (code >= 0x40 && code <= 0x7e) break;
		end++;
	}
	if (end >= text.length) return text.length;
	const body = text.slice(index, end);
	const final = text[end];
	handleCsi(body, final, state, touchedRows, clearRows);
	return end + 1;
}

function handleCsi(body: string, final: string, state: TerminalParseState, touchedRows: Set<number>, clearRows: Set<number>): void {
	const privateMode = body.startsWith("?");
	const params = parseCsiParams(privateMode ? body.slice(1) : body);
	const first = params[0] ?? 1;
	if (privateMode && first === 7 && (final === "h" || final === "l")) {
		state.autowrap = final === "h";
		state.pendingWrap = false;
		return;
	}

	switch (final) {
		case "H":
		case "f":
			setCursor(state, params[0] ?? 1, params[1] ?? 1);
			break;
		case "A":
			moveCursorRows(state, -first);
			break;
		case "B":
		case "e":
			moveCursorRows(state, first);
			break;
		case "C":
		case "a":
			state.col = clamp(state.col + first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "D":
			state.col = clamp(state.col - first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "E":
			moveCursorRows(state, first);
			state.col = 1;
			break;
		case "F":
			moveCursorRows(state, -first);
			state.col = 1;
			break;
		case "G":
		case "`":
			state.col = clamp(first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "d":
			setCursor(state, first, state.col);
			break;
		case "K":
			markRow(state.row, touchedRows);
			markRow(state.row, clearRows);
			break;
		case "J":
			state.clearScreen = true;
			markAllRows(state, touchedRows);
			break;
		case "S":
		case "T":
			state.scrollEvents++;
			markAllRows(state, touchedRows);
			break;
		case "s":
			state.savedRow = state.row;
			state.savedCol = state.col;
			break;
		case "u":
			state.row = state.savedRow;
			state.col = state.savedCol;
			break;
	}
}

function parseCsiParams(body: string): Array<number | undefined> {
	const parameterText = body.replace(/[ -/].*$/u, "");
	if (!parameterText) return [];
	return parameterText.split(";").map((part) => {
		const parsed = Number(part);
		return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
	});
}

function skipUntilStringTerminator(text: string, index: number): number {
	for (let cursor = index; cursor < text.length; cursor++) {
		if (text.charCodeAt(cursor) === 0x07) return cursor + 1;
		if (text.charCodeAt(cursor) === 0x1b && text[cursor + 1] === "\\") return cursor + 2;
	}
	return text.length;
}

function writePrintable(text: string, index: number, state: TerminalParseState, touchedRows: Set<number>, textRows: Set<number>): void {
	if (state.pendingWrap) {
		advanceRowForWrap(state, touchedRows);
		state.col = 1;
		state.pendingWrap = false;
	}
	markRow(state.row, touchedRows);
	markRow(state.row, textRows);
	const width = estimateCodePointWidth(text.codePointAt(index) ?? 0);
	advanceColumns(state, Math.max(1, width), touchedRows);
}

function advanceColumns(state: TerminalParseState, width: number, touchedRows: Set<number>): void {
	for (let step = 0; step < width; step++) {
		if (state.autowrap && state.col >= state.columns) {
			state.pendingWrap = true;
			continue;
		}
		state.col = clamp(state.col + 1, 1, state.columns);
	}
}

function lineFeed(state: TerminalParseState, touchedRows: Set<number>): void {
	state.pendingWrap = false;
	if (state.row >= state.height) {
		state.scrollEvents++;
		markAllRows(state, touchedRows);
		return;
	}
	state.row++;
	state.cursorRowMoves++;
}

function advanceRowForWrap(state: TerminalParseState, touchedRows: Set<number>): void {
	state.wrapAdvances++;
	if (state.row >= state.height) {
		state.scrollEvents++;
		markAllRows(state, touchedRows);
		return;
	}
	state.row++;
	state.cursorRowMoves++;
}

function moveCursorRows(state: TerminalParseState, delta: number): void {
	state.row = clamp(state.row + delta, 1, state.height);
	state.pendingWrap = false;
	state.cursorRowMoves++;
}

function setCursor(state: TerminalParseState, row: number, col: number): void {
	state.row = clamp(row, 1, state.height);
	state.col = clamp(col, 1, state.columns);
	state.pendingWrap = false;
}

function markRow(row: number, rows: Set<number>): void {
	if (Number.isFinite(row) && row >= 1) rows.add(Math.floor(row));
}

function markAllRows(state: TerminalParseState, rows: Set<number>): void {
	for (let row = 1; row <= state.height; row++) rows.add(row);
}

function estimateCodePointWidth(codePoint: number): number {
	if (codePoint === 0) return 0;
	if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
	if (codePoint >= 0x1100 && (
		codePoint <= 0x115f ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff)
	)) return 2;
	return 1;
}

function sortedRows(rows: Set<number>): number[] {
	return Array.from(rows).filter((row) => Number.isFinite(row)).sort((left, right) => left - right);
}

function rangeRows(start: number, end: number): number[] {
	const rows: number[] = [];
	for (let row = Math.max(1, start); row <= end; row++) rows.push(row);
	return rows;
}

function rowsToRanges(rows: readonly number[]): RowRange[] {
	const sorted = [...rows].sort((left, right) => left - right);
	const ranges: RowRange[] = [];
	for (const row of sorted) {
		const previous = ranges[ranges.length - 1];
		if (!previous || row > previous.end + 1) {
			ranges.push({ start: row, end: row });
			continue;
		}
		previous.end = row;
	}
	return ranges;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.floor(value)));
}


function installDebugMarker(logPath: string): DebugMarkerState {
	const state: DebugMarkerState = { logPath, frame: 0, count: 0 };
	const markerProcess = process as DebugMarkerProcess;
	markerProcess[DEBUG_MARKER_STATE] = state;
	if (markerProcess[DEBUG_MARKER_HANDLER_INSTALLED]) return state;
	markerProcess[DEBUG_MARKER_HANDLER_INSTALLED] = true;
	process.on("SIGUSR2", () => {
		const current = (process as DebugMarkerProcess)[DEBUG_MARKER_STATE];
		if (!current) return;
		current.count++;
		writeJsonLine(current.logPath, {
			type: "marker",
			marker: current.count,
			frame: current.frame,
			at: Date.now(),
			signal: "SIGUSR2",
		});
	});
	return state;
}

function summarizeScreenSimulation(
	writes: readonly string[],
	previousLines: readonly string[],
	nextLines: readonly string[],
	before: RenderState,
	after: RenderState,
	previousState: ScreenSimulationState | undefined,
): { summary: ScreenSimulationSummary; state: ScreenSimulationState } {
	const height = Math.max(1, after.previousHeight || after.terminalRows || before.previousHeight || before.terminalRows || 1);
	const columns = Math.max(1, after.terminalColumns || before.terminalColumns || 1);
	const beforeViewportTop = Math.max(0, before.previousViewportTop);
	let state = previousState;
	let resynced: string | undefined;
	if (!state) {
		state = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
		resynced = "initial";
	} else if (state.height !== height || state.columns !== columns) {
		state = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
		resynced = "resize";
	} else if (state.viewportTop !== beforeViewportTop) {
		state = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
		resynced = "viewportMismatch";
	}

	resetScreenSimulationFrameCounters(state);
	for (const write of writes) parseScreenWrite(write, state);

	const afterViewportTop = Math.max(0, after.previousViewportTop);
	const expectedRows = buildLogicalScreenRows(nextLines, afterViewportTop, height, columns);
	const mismatchRows: number[] = [];
	const mismatchSample: Array<{ row: number; expected: string; actual: string }> = [];
	for (let index = 0; index < height; index++) {
		const expected = normalizeScreenCompare(expectedRows[index] ?? "");
		const actual = normalizeScreenCompare(state.rows[index] ?? "");
		if (expected === actual) continue;
		const row = index + 1;
		mismatchRows.push(row);
		if (mismatchSample.length < DEFAULT_CONTEXT_LINES) mismatchSample.push({ row, expected: truncateText(expected, 240), actual: truncateText(actual, 240) });
	}
	state.viewportTop = afterViewportTop;

	return {
		summary: {
			height,
			columns,
			viewportTop: afterViewportTop,
			resynced,
			comparedRows: height,
			mismatchRows,
			mismatchRanges: rowsToRanges(mismatchRows),
			mismatchSample,
			cursorRow: state.row,
			cursorCol: state.col,
			wrapAdvances: state.wrapAdvances,
			scrollEvents: state.scrollEvents,
			clearScreen: state.clearScreen,
		},
		state,
	};
}

function createScreenSimulationState(lines: readonly string[], viewportTop: number, height: number, columns: number, renderState: RenderState): ScreenSimulationState {
	const initialRow = clamp(renderState.hardwareCursorRow - renderState.previousViewportTop + 1, 1, height);
	return {
		row: initialRow,
		col: 1,
		savedRow: initialRow,
		savedCol: 1,
		height,
		columns,
		autowrap: true,
		pendingWrap: false,
		cursorRowMoves: 0,
		wrapAdvances: 0,
		scrollEvents: 0,
		clearScreen: false,
		rows: buildLogicalScreenRows(lines, viewportTop, height, columns),
		viewportTop,
	};
}

function resetScreenSimulationFrameCounters(state: ScreenSimulationState): void {
	state.cursorRowMoves = 0;
	state.wrapAdvances = 0;
	state.scrollEvents = 0;
	state.clearScreen = false;
}

function buildLogicalScreenRows(lines: readonly string[], viewportTop: number, height: number, columns: number): string[] {
	const rows: string[] = [];
	for (let row = 0; row < height; row++) rows.push(normalizeScreenRow(stripAnsi(lines[viewportTop + row] ?? ""), columns));
	return rows;
}

function parseScreenWrite(text: string, state: ScreenSimulationState): void {
	for (let index = 0; index < text.length;) {
		const code = text.charCodeAt(index);
		if (code === 0x1b) {
			index = parseScreenEscape(text, index, state);
			continue;
		}
		if (code === 0x0d) {
			state.col = 1;
			state.pendingWrap = false;
			index++;
			continue;
		}
		if (code === 0x0a) {
			screenLineFeed(state);
			index++;
			continue;
		}
		if (code >= 0x20 && code !== 0x7f) {
			writeScreenPrintable(text, index, state);
			index += text.codePointAt(index)! > 0xffff ? 2 : 1;
			continue;
		}
		index++;
	}
}

function parseScreenEscape(text: string, index: number, state: ScreenSimulationState): number {
	const next = text[index + 1];
	if (next === "[") return parseScreenCsi(text, index + 2, state);
	if (next === "]") return skipUntilStringTerminator(text, index + 2);
	if (next === "P" || next === "_" || next === "^" || next === "X") return skipUntilStringTerminator(text, index + 2);
	if (next === "s") {
		state.savedRow = state.row;
		state.savedCol = state.col;
		state.pendingWrap = false;
		return index + 2;
	}
	if (next === "u") {
		state.row = state.savedRow;
		state.col = state.savedCol;
		state.pendingWrap = false;
		return index + 2;
	}
	return Math.min(text.length, index + 2);
}

function parseScreenCsi(text: string, index: number, state: ScreenSimulationState): number {
	let end = index;
	while (end < text.length) {
		const code = text.charCodeAt(end);
		if (code >= 0x40 && code <= 0x7e) break;
		end++;
	}
	if (end >= text.length) return text.length;
	const body = text.slice(index, end);
	const final = text[end];
	handleScreenCsi(body, final, state);
	return end + 1;
}

function handleScreenCsi(body: string, final: string, state: ScreenSimulationState): void {
	const privateMode = body.startsWith("?");
	const params = parseCsiParams(privateMode ? body.slice(1) : body);
	const first = params[0] ?? 1;
	if (privateMode && first === 7 && (final === "h" || final === "l")) {
		state.autowrap = final === "h";
		state.pendingWrap = false;
		return;
	}

	switch (final) {
		case "H":
		case "f":
			setCursor(state, params[0] ?? 1, params[1] ?? 1);
			break;
		case "A":
			moveCursorRows(state, -first);
			break;
		case "B":
		case "e":
			moveCursorRows(state, first);
			break;
		case "C":
		case "a":
			state.col = clamp(state.col + first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "D":
			state.col = clamp(state.col - first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "E":
			moveCursorRows(state, first);
			state.col = 1;
			break;
		case "F":
			moveCursorRows(state, -first);
			state.col = 1;
			break;
		case "G":
		case "`":
			state.col = clamp(first, 1, state.columns);
			state.pendingWrap = false;
			break;
		case "d":
			setCursor(state, first, state.col);
			break;
		case "K":
			clearScreenRow(state, params[0] ?? 0);
			break;
		case "J":
			clearScreenRows(state, params[0] ?? 0);
			break;
		case "S":
			scrollScreenUp(state, first);
			break;
		case "T":
			scrollScreenDown(state, first);
			break;
		case "s":
			state.savedRow = state.row;
			state.savedCol = state.col;
			break;
		case "u":
			state.row = state.savedRow;
			state.col = state.savedCol;
			break;
	}
}

function writeScreenPrintable(text: string, index: number, state: ScreenSimulationState): void {
	if (state.pendingWrap) {
		screenAdvanceRowForWrap(state);
		state.col = 1;
		state.pendingWrap = false;
	}
	const codePoint = text.codePointAt(index) ?? 0;
	const value = String.fromCodePoint(codePoint);
	const width = Math.max(1, estimateCodePointWidth(codePoint));
	writeScreenCell(state, value, width);
	advanceScreenColumns(state, width);
}

function writeScreenCell(state: ScreenSimulationState, value: string, width: number): void {
	const rowIndex = clamp(state.row, 1, state.height) - 1;
	const colIndex = clamp(state.col, 1, state.columns) - 1;
	const cells = screenRowToCells(state.rows[rowIndex] ?? "", state.columns);
	cells[colIndex] = value;
	for (let offset = 1; offset < width && colIndex + offset < cells.length; offset++) cells[colIndex + offset] = " ";
	state.rows[rowIndex] = cells.join("").slice(0, state.columns);
}

function advanceScreenColumns(state: ScreenSimulationState, width: number): void {
	for (let step = 0; step < width; step++) {
		if (state.autowrap && state.col >= state.columns) {
			state.pendingWrap = true;
			continue;
		}
		state.col = clamp(state.col + 1, 1, state.columns);
	}
}

function screenLineFeed(state: ScreenSimulationState): void {
	state.pendingWrap = false;
	if (state.row >= state.height) {
		scrollScreenUp(state, 1);
		return;
	}
	state.row++;
	state.cursorRowMoves++;
}

function screenAdvanceRowForWrap(state: ScreenSimulationState): void {
	state.wrapAdvances++;
	if (state.row >= state.height) {
		scrollScreenUp(state, 1);
		return;
	}
	state.row++;
	state.cursorRowMoves++;
}

function clearScreenRow(state: ScreenSimulationState, mode: number): void {
	const rowIndex = clamp(state.row, 1, state.height) - 1;
	const cells = screenRowToCells(state.rows[rowIndex] ?? "", state.columns);
	if (mode === 1) {
		for (let index = 0; index < state.col; index++) cells[index] = " ";
	} else if (mode === 2) {
		for (let index = 0; index < cells.length; index++) cells[index] = " ";
	} else {
		for (let index = Math.max(0, state.col - 1); index < cells.length; index++) cells[index] = " ";
	}
	state.rows[rowIndex] = cells.join("");
}

function clearScreenRows(state: ScreenSimulationState, mode: number): void {
	state.clearScreen = true;
	if (mode === 1) {
		for (let row = 0; row < state.row - 1; row++) state.rows[row] = blankScreenRow(state.columns);
		clearScreenRow(state, 1);
		return;
	}
	if (mode === 2 || mode === 3) {
		for (let row = 0; row < state.height; row++) state.rows[row] = blankScreenRow(state.columns);
		return;
	}
	clearScreenRow(state, 0);
	for (let row = state.row; row < state.height; row++) state.rows[row] = blankScreenRow(state.columns);
}

function scrollScreenUp(state: ScreenSimulationState, count: number): void {
	const amount = clamp(count, 1, state.height);
	state.scrollEvents += amount;
	state.rows.splice(0, amount);
	while (state.rows.length < state.height) state.rows.push(blankScreenRow(state.columns));
}

function scrollScreenDown(state: ScreenSimulationState, count: number): void {
	const amount = clamp(count, 1, state.height);
	state.scrollEvents += amount;
	state.rows.splice(Math.max(0, state.height - amount), amount);
	while (state.rows.length < state.height) state.rows.unshift(blankScreenRow(state.columns));
}

function screenRowToCells(row: string, columns: number): string[] {
	const cells = Array.from(row);
	while (cells.length < columns) cells.push(" ");
	return cells.slice(0, columns);
}

function normalizeScreenRow(row: string, columns: number): string {
	const cells: string[] = [];
	for (let index = 0; index < row.length && cells.length < columns;) {
		const codePoint = row.codePointAt(index) ?? 0;
		const value = String.fromCodePoint(codePoint);
		const width = Math.max(1, estimateCodePointWidth(codePoint));
		cells.push(value);
		for (let offset = 1; offset < width && cells.length < columns; offset++) cells.push(" ");
		index += codePoint > 0xffff ? 2 : 1;
	}
	while (cells.length < columns) cells.push(" ");
	return cells.join("");
}

function blankScreenRow(columns: number): string {
	return " ".repeat(Math.max(1, columns));
}

function normalizeScreenCompare(line: string): string {
	return stripAnsi(line).replace(/[ \t]+$/gu, "");
}


function summarizePhysicalSyncDebug(tui: AnyTui) {
	const events = tui[PHYSICAL_SYNC_DEBUG_EVENTS];
	if (!Array.isArray(events)) return undefined;
	let selfHeal;
	let anchorRewriteCount = 0;
	let rawLeadingRelativeCount = 0;
	const writeKindCounts: Record<string, number> = {};
	for (const event of events) {
		if (!event || typeof event !== "object") continue;
		const type = String((event as { type?: unknown }).type ?? "");
		if (type === "selfHeal") selfHeal = event;
		if (type !== "writeRewrite") continue;
		const rawKind = String((event as { rawKind?: unknown }).rawKind ?? "unknown");
		const finalKind = String((event as { finalKind?: unknown }).finalKind ?? "unknown");
		writeKindCounts[`${rawKind}->${finalKind}`] = (writeKindCounts[`${rawKind}->${finalKind}`] ?? 0) + 1;
		if ((event as { rewritten?: unknown }).rewritten === true) anchorRewriteCount++;
		if (rawKind === "leadingRelativeUp" || rawKind === "leadingRelativeDown") rawLeadingRelativeCount++;
	}
	return {
		events,
		selfHeal,
		writeRewriteCount: events.filter((event) => (event as { type?: unknown })?.type === "writeRewrite").length,
		anchorRewriteCount,
		rawLeadingRelativeCount,
		writeKindCounts,
	};
}

function summarizeWrites(writes: string[]) {
	const maxBytes = readPositiveEnvNumber("PI_DROID_RENDER_DEBUG_MAX_TEXT_BYTES", DEFAULT_MAX_TEXT_BYTES);
	const combined = writes.join("");
	return {
		count: writes.length,
		bytes: Buffer.byteLength(combined, "utf8"),
		text: truncateText(combined, maxBytes),
		chunks: writes.map((write, index) => ({
			index,
			bytes: Buffer.byteLength(write, "utf8"),
			text: truncateText(write, Math.min(12_000, maxBytes)),
		})),
	};
}

function readPositiveEnvNumber(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}…<truncated ${text.length - maxLength} chars>`;
}

function stripAnsi(text: string): string {
	return text
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b_G[^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
