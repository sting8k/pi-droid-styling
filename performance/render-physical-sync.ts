import { profileCount } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.render-physical-sync.patched");
const DEBUG_EVENTS = Symbol.for("pi-droid-styling.render-physical-sync.debug-events");
const BEGIN_SYNC = "\x1b[?2026h";
const END_SYNC = "\x1b[?2026l";
const SAVE_CURSOR = "\x1b[s";
const RESTORE_CURSOR = "\x1b[u";
const DISABLE_AUTOWRAP = "\x1b[?7l";
const ENABLE_AUTOWRAP = "\x1b[?7h";
const DEFAULT_FULL_REPAINT_INTERVAL_MS = 200;
const DEFAULT_FULL_SWEEP_INTERVAL_MS = 1000;
const SELF_HEAL_BAND_CONTEXT_ROWS = 1;
const SELF_HEAL_FALLBACK_SEAM_ROWS = 3;
const DEBUG_TEXT_PREVIEW_CHARS = 240;

type SelfHealMode = "band" | "viewport";
type SelfHealReason = "none" | "first" | "viewport-remap" | "viewport-line-change" | "viewport-interval" | "full-sweep" | "line-change-band" | "interval-band";

type AnyTui = {
	doRender?: (...args: unknown[]) => unknown;
	terminal?: { write?: (data: string) => unknown; rows?: number };
	previousLines?: unknown;
	previousHeight?: unknown;
	previousViewportTop?: unknown;
	hardwareCursorRow?: unknown;
	[PATCHED]?: ((...args: unknown[]) => unknown) | boolean;
	[DEBUG_EVENTS]?: PhysicalSyncDebugEvent[];
};

type RenderAnchorState = {
	currentScreenRow: number;
	terminalRows: number;
};

type ViewportVisualState = {
	lineCount: number;
	viewportTop: number;
	height: number;
};

type LineChangeSummary = {
	firstChanged: number;
	lastChanged: number;
	lineCountChanged: boolean;
};

type RowRange = {
	start: number;
	end: number;
};

type SelfHealRepaint = {
	output: string;
	fullViewport: boolean;
	reason: SelfHealReason;
	ranges: RowRange[];
	rows: number;
	changes: LineChangeSummary;
	intervalDue: boolean;
	fullSweepDue: boolean;
};

type PhysicalSyncDebugEvent =
	| {
		type: "writeRewrite";
		rawKind: string;
		finalKind: string;
		rewritten: boolean;
		targetRow?: number;
		rawBytes: number;
		finalBytes: number;
		rawPreview: string;
		finalPreview: string;
	}
	| {
		type: "selfHeal";
		mode: SelfHealMode;
		reason: SelfHealReason;
		fullViewport: boolean;
		ranges: RowRange[];
		rows: number;
		previousState: ViewportVisualState;
		currentState: ViewportVisualState;
		changes: LineChangeSummary;
		intervalDue: boolean;
		fullSweepDue: boolean;
		elapsedSinceSelfHealMs: number;
		elapsedSinceFullSweepMs: number;
		bytes: number;
	};

type NormalizedWrite = {
	text: string;
	rawKind: string;
	finalKind: string;
	rewritten: boolean;
	targetRow?: number;
};

export function installRenderPhysicalSync(tui: AnyTui): void {
	if (process.env.PI_DROID_RENDER_PHYSICAL_SYNC === "0") return;
	const anchorEnabled = process.env.PI_DROID_RENDER_ABSOLUTE_ANCHOR !== "0";
	const shapeRepaintEnabled = process.env.PI_DROID_RENDER_SHAPE_REPAINT !== "0";
	const periodicSelfHealEnabled = process.env.PI_DROID_RENDER_FULL_REPAINT === "1";
	const repaintEnabled = shapeRepaintEnabled || periodicSelfHealEnabled;
	if (!anchorEnabled && !repaintEnabled) return;
	if (!tui || typeof tui.doRender !== "function") return;
	const patched = tui[PATCHED];
	if (typeof patched === "function" && tui.doRender === patched) return;
	if (patched === true && tui.doRender.name === "physicallySyncedDoRender") return;
	const terminal = tui.terminal;
	if (!terminal || typeof terminal.write !== "function") return;

	const originalDoRender = tui.doRender.bind(tui);
	const fullRepaintIntervalMs = readFullRepaintIntervalMs();
	const fullSweepIntervalMs = readFullSweepIntervalMs();
	const selfHealMode = readSelfHealMode();
	const debugEnabled = process.env.PI_DROID_RENDER_DEBUG === "1";
	let lastSelfHealAt = 0;
	let lastFullSweepAt = 0;
	const physicallySyncedDoRender = function physicallySyncedDoRender(this: unknown, ...args: unknown[]): unknown {
		const activeWrite = terminal.write;
		if (typeof activeWrite !== "function") return originalDoRender(...args);
		if (debugEnabled) tui[DEBUG_EVENTS] = [];

		const previousLines = repaintEnabled ? readStringLines(tui.previousLines) : [];
		const previousViewportVisualState = readViewportVisualStateFromLines(tui, previousLines);
		const anchorState = anchorEnabled ? readAnchorState(tui) : undefined;
		terminal.write = function physicallySyncedWrite(this: unknown, data: string): unknown {
			const text = String(data);
			const normalized = anchorState ? normalizeLeadingRelativeMove(text, anchorState) : unchangedWrite(text);
			if (debugEnabled) pushDebugEvent(tui, buildWriteRewriteDebugEvent(text, normalized));
			return activeWrite.call(this, normalized.text);
		};
		try {
			const result = originalDoRender(...args);
			if (repaintEnabled) {
				const currentLines = readStringLines(tui.previousLines);
				const currentViewportVisualState = readViewportVisualStateFromLines(tui, currentLines);
				const now = Date.now();
				const repaint = buildSelfHealRepaint(
					tui,
					previousLines,
					currentLines,
					previousViewportVisualState,
					currentViewportVisualState,
					now,
					lastSelfHealAt,
					lastFullSweepAt,
					fullRepaintIntervalMs,
					fullSweepIntervalMs,
					shapeRepaintEnabled,
					periodicSelfHealEnabled,
					selfHealMode,
				);
				if (debugEnabled) pushDebugEvent(tui, buildSelfHealDebugEvent(repaint, selfHealMode, previousViewportVisualState, currentViewportVisualState, now, lastSelfHealAt, lastFullSweepAt, fullRepaintIntervalMs, fullSweepIntervalMs));
				if (repaint.output.length > 0) {
					lastSelfHealAt = now;
					if (repaint.fullViewport) lastFullSweepAt = now;
					activeWrite.call(terminal, repaint.output);
				} else {
					profileCount("render.physicalSync.selfHeal.skipInterval");
				}
			}
			return result;
		} finally {
			terminal.write = activeWrite;
		}
	};
	tui[PATCHED] = physicallySyncedDoRender;
	tui.doRender = physicallySyncedDoRender;
}

function readFullRepaintIntervalMs(): number {
	const parsed = Number(process.env.PI_DROID_RENDER_FULL_REPAINT_INTERVAL_MS);
	if (!Number.isFinite(parsed)) return DEFAULT_FULL_REPAINT_INTERVAL_MS;
	return Math.max(0, Math.floor(parsed));
}

function readFullSweepIntervalMs(): number {
	const parsed = Number(process.env.PI_DROID_RENDER_FULL_SWEEP_INTERVAL_MS);
	if (!Number.isFinite(parsed)) return DEFAULT_FULL_SWEEP_INTERVAL_MS;
	return Math.max(0, Math.floor(parsed));
}

function readSelfHealMode(): SelfHealMode {
	const value = process.env.PI_DROID_RENDER_SELF_HEAL_MODE;
	return value === "viewport" || value === "full" ? "viewport" : "band";
}

function buildSelfHealRepaint(
	tui: AnyTui,
	previousLines: string[],
	currentLines: string[],
	previousState: ViewportVisualState,
	currentState: ViewportVisualState,
	now: number,
	lastSelfHealAt: number,
	lastFullSweepAt: number,
	intervalMs: number,
	fullSweepIntervalMs: number,
	shapeRepaintEnabled: boolean,
	periodicSelfHealEnabled: boolean,
	mode: SelfHealMode,
): SelfHealRepaint {
	if (currentLines.length === 0) return noSelfHealRepaint(emptyLineChanges(), false, false);

	const changes = summarizeLineChanges(previousLines, currentLines);
	const firstSelfHeal = lastSelfHealAt <= 0;
	const viewportRemapped = hasViewportMappingChanged(previousState, currentState);
	const intervalDue = periodicSelfHealEnabled && (intervalMs <= 0 || now - lastSelfHealAt >= intervalMs);
	const fullSweepDue = periodicSelfHealEnabled && isFullSweepDue(now, lastFullSweepAt, fullSweepIntervalMs);
	if (mode === "viewport") {
		if (shapeRepaintEnabled && viewportRemapped) return fullViewportSelfHeal(currentLines, currentState, "viewport-remap", changes, intervalDue, fullSweepDue);
		if (shapeRepaintEnabled && changes.firstChanged >= 0) return fullViewportSelfHeal(currentLines, currentState, "viewport-line-change", changes, intervalDue, fullSweepDue);
		if (periodicSelfHealEnabled && firstSelfHeal) return fullViewportSelfHeal(currentLines, currentState, "first", changes, intervalDue, fullSweepDue);
		if (intervalDue) return fullViewportSelfHeal(currentLines, currentState, "viewport-interval", changes, intervalDue, fullSweepDue);
		return noSelfHealRepaint(changes, intervalDue, fullSweepDue);
	}

	if (periodicSelfHealEnabled && firstSelfHeal) return fullViewportSelfHeal(currentLines, currentState, "first", changes, intervalDue, fullSweepDue);
	if (shapeRepaintEnabled && viewportRemapped) return fullViewportSelfHeal(currentLines, currentState, "viewport-remap", changes, intervalDue, fullSweepDue);
	if (shapeRepaintEnabled && changes.firstChanged >= 0) {
		const ranges = buildLineChangeRanges(changes, currentState, false);
		const cursorScreenRow = clamp(readNumber(tui.hardwareCursorRow) - currentState.viewportTop + 1, 1, currentState.height);
		ranges.push({ start: cursorScreenRow - SELF_HEAL_BAND_CONTEXT_ROWS, end: cursorScreenRow + SELF_HEAL_BAND_CONTEXT_ROWS });
		return bandSelfHeal(currentLines, currentState, ranges, "line-change-band", changes, intervalDue, fullSweepDue);
	}
	if (fullSweepDue) return fullViewportSelfHeal(currentLines, currentState, "full-sweep", changes, intervalDue, fullSweepDue);
	if (intervalDue) return bandSelfHeal(currentLines, currentState, buildFallbackRanges(tui, changes, currentState), "interval-band", changes, intervalDue, fullSweepDue);
	return noSelfHealRepaint(changes, intervalDue, fullSweepDue);
}

function noSelfHealRepaint(changes: LineChangeSummary, intervalDue: boolean, fullSweepDue: boolean): SelfHealRepaint {
	return { output: "", fullViewport: false, reason: "none", ranges: [], rows: 0, changes, intervalDue, fullSweepDue };
}

function fullViewportSelfHeal(lines: readonly string[], state: ViewportVisualState, reason: SelfHealReason, changes: LineChangeSummary, intervalDue: boolean, fullSweepDue: boolean): SelfHealRepaint {
	const range = { start: 1, end: state.height };
	return { output: buildFullViewportRepaint(lines, state), fullViewport: true, reason, ranges: [range], rows: countRows([range]), changes, intervalDue, fullSweepDue };
}

function bandSelfHeal(lines: readonly string[], state: ViewportVisualState, ranges: RowRange[], reason: SelfHealReason, changes: LineChangeSummary, intervalDue: boolean, fullSweepDue: boolean): SelfHealRepaint {
	const mergedRanges = mergeRanges(ranges, state.height);
	return { output: buildBandRepaint(lines, state, mergedRanges), fullViewport: false, reason, ranges: mergedRanges, rows: countRows(mergedRanges), changes, intervalDue, fullSweepDue };
}

function isFullSweepDue(now: number, lastFullSweepAt: number, intervalMs: number): boolean {
	return intervalMs > 0 && lastFullSweepAt > 0 && now - lastFullSweepAt >= intervalMs;
}

function emptyLineChanges(): LineChangeSummary {
	return { firstChanged: -1, lastChanged: -1, lineCountChanged: false };
}

function countRows(ranges: readonly RowRange[]): number {
	return ranges.reduce((total, range) => total + Math.max(0, range.end - range.start + 1), 0);
}

function summarizeLineChanges(previousLines: string[], currentLines: string[]): LineChangeSummary {
	let firstChanged = -1;
	let lastChanged = -1;
	const max = Math.max(previousLines.length, currentLines.length);
	for (let index = 0; index < max; index++) {
		if ((previousLines[index] ?? "") === (currentLines[index] ?? "")) continue;
		if (firstChanged === -1) firstChanged = index;
		lastChanged = index;
	}
	return {
		firstChanged,
		lastChanged,
		lineCountChanged: previousLines.length !== currentLines.length,
	};
}

function hasViewportMappingChanged(previousState: ViewportVisualState, currentState: ViewportVisualState): boolean {
	return previousState.viewportTop !== currentState.viewportTop || previousState.height !== currentState.height;
}

function buildLineChangeRanges(changes: LineChangeSummary, state: ViewportVisualState, throughVisibleBottom: boolean): RowRange[] {
	if (changes.firstChanged < 0) return [];
	const visibleStart = state.viewportTop;
	const visibleEnd = state.viewportTop + state.height - 1;
	const startLine = Math.max(visibleStart, changes.firstChanged - SELF_HEAL_BAND_CONTEXT_ROWS);
	const endLine = Math.min(visibleEnd, throughVisibleBottom ? visibleEnd : changes.lastChanged + SELF_HEAL_BAND_CONTEXT_ROWS);
	if (startLine > visibleEnd || endLine < visibleStart || startLine > endLine) return [];
	return [{ start: startLine - state.viewportTop + 1, end: endLine - state.viewportTop + 1 }];
}

function buildFallbackRanges(tui: AnyTui, changes: LineChangeSummary, state: ViewportVisualState): RowRange[] {
	const ranges = buildLineChangeRanges(changes, state, false);
	const cursorScreenRow = clamp(readNumber(tui.hardwareCursorRow) - state.viewportTop + 1, 1, state.height);
	ranges.push({ start: cursorScreenRow - SELF_HEAL_BAND_CONTEXT_ROWS, end: cursorScreenRow + SELF_HEAL_BAND_CONTEXT_ROWS });
	ranges.push({ start: state.height - SELF_HEAL_FALLBACK_SEAM_ROWS + 1, end: state.height });
	return ranges;
}

function buildBandRepaint(lines: readonly string[], state: ViewportVisualState, ranges: RowRange[]): string {
	const mergedRanges = mergeRanges(ranges, state.height);
	if (mergedRanges.length === 0) return "";

	let rowCount = 0;
	let output = DISABLE_AUTOWRAP + SAVE_CURSOR + BEGIN_SYNC;
	for (const range of mergedRanges) {
		for (let row = range.start; row <= range.end; row++) {
			output += `\x1b[${row};1H\x1b[2K${lines[state.viewportTop + row - 1] ?? ""}`;
			rowCount++;
		}
	}
	profileCount("render.physicalSync.bandRepaint");
	profileCount("render.physicalSync.bandRepaint.row", rowCount);
	return output + END_SYNC + RESTORE_CURSOR + ENABLE_AUTOWRAP;
}

function mergeRanges(ranges: RowRange[], height: number): RowRange[] {
	const normalized = ranges
		.map((range) => ({ start: clamp(range.start, 1, height), end: clamp(range.end, 1, height) }))
		.filter((range) => range.start <= range.end)
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: RowRange[] = [];
	for (const range of normalized) {
		const previous = merged[merged.length - 1];
		if (!previous || range.start > previous.end + 1) {
			merged.push({ ...range });
			continue;
		}
		previous.end = Math.max(previous.end, range.end);
	}
	return merged;
}

function readViewportVisualStateFromLines(tui: AnyTui, lines: readonly string[]): ViewportVisualState {
	return {
		lineCount: lines.length,
		viewportTop: Math.max(0, readNumber(tui.previousViewportTop)),
		height: readViewportHeight(tui),
	};
}

function readViewportHeight(tui: AnyTui): number {
	const previousHeight = readNumber(tui.previousHeight);
	const terminalRows = readNumber(tui.terminal?.rows);
	return Math.max(1, terminalRows > 0 && previousHeight > 0 ? Math.min(previousHeight, terminalRows) : previousHeight || terminalRows || 1);
}

function buildFullViewportRepaint(lines: readonly string[], state: ViewportVisualState): string {
	let output = DISABLE_AUTOWRAP + SAVE_CURSOR + BEGIN_SYNC;
	for (let row = 1; row <= state.height; row++) {
		output += `\x1b[${row};1H\x1b[2K${lines[state.viewportTop + row - 1] ?? ""}`;
	}
	profileCount("render.physicalSync.fullViewportRepaint");
	return output + END_SYNC + RESTORE_CURSOR + ENABLE_AUTOWRAP;
}

function readAnchorState(tui: AnyTui): RenderAnchorState {
	const hardwareCursorRow = readNumber(tui.hardwareCursorRow);
	const previousViewportTop = readNumber(tui.previousViewportTop);
	const terminalRows = Math.max(1, readNumber(tui.terminal?.rows) || 1);
	return {
		currentScreenRow: clamp(hardwareCursorRow - previousViewportTop, 0, terminalRows - 1),
		terminalRows,
	};
}

function normalizeLeadingRelativeMove(data: string, state: RenderAnchorState): NormalizedWrite {
	if (!data.startsWith(BEGIN_SYNC)) return unchangedWrite(data);
	const rest = data.slice(BEGIN_SYNC.length);

	const upMatch = rest.match(/^\x1b\[(\d+)A\r/);
	if (upMatch) {
		const targetScreenRow = state.currentScreenRow - Number(upMatch[1]);
		return replaceLeadingMove(data, upMatch[0].length, targetScreenRow, state.terminalRows, "leadingRelativeUp");
	}

	const downMatch = rest.match(/^\x1b\[(\d+)B\r/);
	if (downMatch) {
		const targetScreenRow = state.currentScreenRow + Number(downMatch[1]);
		return replaceLeadingMove(data, downMatch[0].length, targetScreenRow, state.terminalRows, "leadingRelativeDown");
	}

	if (rest.startsWith("\r")) {
		return replaceLeadingMove(data, 1, state.currentScreenRow, state.terminalRows, "leadingCarriageReturn");
	}

	return unchangedWrite(data);
}

function unchangedWrite(data: string): NormalizedWrite {
	const kind = classifyWriteKind(data);
	return { text: data, rawKind: kind, finalKind: kind, rewritten: false };
}

function replaceLeadingMove(data: string, matchedLength: number, targetScreenRow: number, terminalRows: number, rawKind: string): NormalizedWrite {
	const row = clamp(Math.floor(targetScreenRow) + 1, 1, terminalRows);
	profileCount("render.physicalSync.absoluteAnchor.rewrite");
	return {
		text: `${BEGIN_SYNC}\x1b[${row};1H${data.slice(BEGIN_SYNC.length + matchedLength)}`,
		rawKind,
		finalKind: "leadingAbsoluteAnchor",
		rewritten: true,
		targetRow: row,
	};
}

function classifyWriteKind(data: string): string {
	if (data.startsWith(DISABLE_AUTOWRAP + SAVE_CURSOR + BEGIN_SYNC)) return "physicalSelfHeal";
	if (!data.startsWith(BEGIN_SYNC)) return "plain";
	const rest = data.slice(BEGIN_SYNC.length);
	if (/^\x1b\[\d+A\r/u.test(rest)) return "leadingRelativeUp";
	if (/^\x1b\[\d+B\r/u.test(rest)) return "leadingRelativeDown";
	if (/^\x1b\[\d+;1H/u.test(rest)) return "leadingAbsoluteAnchor";
	if (rest.startsWith("\r")) return "leadingCarriageReturn";
	return "beginSync";
}

function pushDebugEvent(tui: AnyTui, event: PhysicalSyncDebugEvent): void {
	const events = tui[DEBUG_EVENTS];
	if (Array.isArray(events)) events.push(event);
}

function buildWriteRewriteDebugEvent(rawText: string, normalized: NormalizedWrite): PhysicalSyncDebugEvent {
	return {
		type: "writeRewrite",
		rawKind: normalized.rawKind,
		finalKind: normalized.finalKind,
		rewritten: normalized.rewritten,
		targetRow: normalized.targetRow,
		rawBytes: byteLength(rawText),
		finalBytes: byteLength(normalized.text),
		rawPreview: truncateText(rawText, DEBUG_TEXT_PREVIEW_CHARS),
		finalPreview: truncateText(normalized.text, DEBUG_TEXT_PREVIEW_CHARS),
	};
}

function buildSelfHealDebugEvent(
	repaint: SelfHealRepaint,
	mode: SelfHealMode,
	previousState: ViewportVisualState,
	currentState: ViewportVisualState,
	now: number,
	lastSelfHealAt: number,
	lastFullSweepAt: number,
	intervalMs: number,
	fullSweepIntervalMs: number,
): PhysicalSyncDebugEvent {
	return {
		type: "selfHeal",
		mode,
		reason: repaint.reason,
		fullViewport: repaint.fullViewport,
		ranges: repaint.ranges,
		rows: repaint.rows,
		previousState,
		currentState,
		changes: repaint.changes,
		intervalDue: repaint.intervalDue,
		fullSweepDue: repaint.fullSweepDue,
		elapsedSinceSelfHealMs: elapsedSince(now, lastSelfHealAt, intervalMs),
		elapsedSinceFullSweepMs: elapsedSince(now, lastFullSweepAt, fullSweepIntervalMs),
		bytes: byteLength(repaint.output),
	};
}

function elapsedSince(now: number, previous: number, intervalMs: number): number {
	if (previous <= 0) return intervalMs <= 0 ? 0 : intervalMs;
	return Math.max(0, now - previous);
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}…<truncated ${text.length - maxLength} chars>`;
}

function readStringLines(value: unknown): string[] {
	return Array.isArray(value) ? value.map((line) => String(line)) : [];
}

function readNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
