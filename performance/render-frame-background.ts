import { paintFrameBackgroundClears, paintFrameBackgroundLines, padFrameRows, resolveFrameBackgroundAnsi } from "../theme/frame-background.js";
import { profileCount } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.render-frame-background.patched");
const WRITE_PATCHED = Symbol.for("pi-droid-styling.render-frame-background.write-patched");

type ApplyLineResetsFunction = (lines: string[]) => string[];

type TuiLike = {
	applyLineResets?: ApplyLineResetsFunction;
	terminal?: TerminalLike;
	[PATCHED]?: ApplyLineResetsFunction | boolean;
};

type TerminalWriteFunction = (data: string) => unknown;

type TerminalLike = {
	columns?: number;
	rows?: number;
	write?: TerminalWriteFunction;
	[WRITE_PATCHED]?: FrameBackgroundWritePatch;
};

type FrameBackgroundWritePatch = {
	theme: any;
	wrapper: TerminalWriteFunction;
};

function readRows(tui: TuiLike): number {
	const rows = tui.terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 0;
}

function readColumns(tui: TuiLike): number {
	const columns = tui.terminal?.columns;
	return typeof columns === "number" && Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 0;
}

function installFrameBackgroundClearWriter(tui: TuiLike, theme: any): void {
	const terminal = tui.terminal;
	if (!terminal || typeof terminal.write !== "function") return;
	const existingPatch = terminal[WRITE_PATCHED];
	if (existingPatch && terminal.write === existingPatch.wrapper) {
		existingPatch.theme = theme;
		return;
	}

	const originalWrite = terminal.write.bind(terminal);
	const patch: FrameBackgroundWritePatch = {
		theme,
		wrapper(data: string): unknown {
			const text = String(data);
			const bgAnsi = resolveFrameBackgroundAnsi(patch.theme);
			return originalWrite(bgAnsi ? paintFrameBackgroundClears(text, bgAnsi) : text);
		},
	};
	terminal[WRITE_PATCHED] = patch;
	terminal.write = patch.wrapper;
}

export function installRenderFrameBackground(tui: TuiLike, theme: any): void {
	if (process.env.PI_DROID_RENDER_FRAME_BG === "0") return;
	if (!tui || typeof tui.applyLineResets !== "function") return;
	installFrameBackgroundClearWriter(tui, theme);
	const patched = tui[PATCHED];
	if (typeof patched === "function" && tui.applyLineResets === patched) return;
	if (patched === true && tui.applyLineResets.name === "droidFrameBackgroundApplyLineResets") return;

	const originalApplyLineResets = tui.applyLineResets.bind(tui);
	const droidFrameBackgroundApplyLineResets = function droidFrameBackgroundApplyLineResets(lines: string[]): string[] {
		const bgAnsi = resolveFrameBackgroundAnsi(theme);
		if (!bgAnsi) return originalApplyLineResets(lines);
		const frameLines = padFrameRows(lines, readRows(tui));
		const resetLines = originalApplyLineResets(frameLines);
		profileCount("render.frameBackground.row", resetLines.length);
		return paintFrameBackgroundLines(resetLines, bgAnsi, readColumns(tui));
	};

	tui[PATCHED] = droidFrameBackgroundApplyLineResets;
	tui.applyLineResets = droidFrameBackgroundApplyLineResets;
}
