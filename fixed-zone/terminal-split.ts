import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { type FixedZoneCluster, type FixedZoneClusterOptions, type HiddenRenderable, renderFixedUserZoneCluster } from "./cluster.js";

interface TerminalLike {
	write(data: string): void;
	columns: number;
	rows: number;
}

interface TuiLike {
	terminal: TerminalLike;
	render(width: number): string[];
	requestRender(force?: boolean): void;
	doRender?(): void;
}

export interface TerminalSplitOptions {
	mouseScroll: boolean;
	onCopySelection?: (text: string) => void;
}

interface SgrMousePacket {
	button: number;
	col: number;
	row: number;
	final: "M" | "m";
}

interface SelectionPoint {
	line: number;
	col: number;
}

const MIN_SCROLLABLE_ROWS = 3;
const WHEEL_SCROLL_LINES = 3;
const JUMP_BOTTOM_INPUT = "\x07";
const JUMP_TOP_INPUT = "\x14";
const TOP_HINT = "^Shift T TOP";
const BOTTOM_HINT = "^Shift G BOT";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?1007l";
const DISABLE_MOUSE = "\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1007h";

function setScrollRegion(top: number, bottom: number): string {
	return `\x1b[${top};${bottom}r`;
}

function moveCursor(row: number, col: number): string {
	return `\x1b[${row};${col}H`;
}

function clearLine(): string {
	return "\x1b[2K";
}

function saveCursor(): string {
	return "\x1b[s";
}

function restoreCursor(): string {
	return "\x1b[u";
}

function findPropertyDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
	let current: object | null = target;
	while (current) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) return descriptor;
		current = Object.getPrototypeOf(current);
	}
	return undefined;
}

function fitLine(line: string, width: number): string {
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "");
}

const SGR_MOUSE_EVENT_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

function parseMouseInput(data: string): { packets: SgrMousePacket[]; filtered: string } {
	const packets: SgrMousePacket[] = [];
	const filtered = data.replace(SGR_MOUSE_EVENT_PATTERN, (_event, buttonText: string, colText: string, rowText: string, finalText: string) => {
		const button = Number(buttonText);
		const col = Number(colText);
		const row = Number(rowText);
		if (Number.isFinite(button) && Number.isFinite(col) && Number.isFinite(row)) {
			packets.push({ button, col, row, final: finalText as "M" | "m" });
		}
		return "";
	});
	return { packets, filtered };
}

function mouseBaseButton(button: number): number {
	return button & ~(4 | 8 | 16 | 32);
}

function mouseScrollDelta(packet: SgrMousePacket): number {
	if (packet.final !== "M") return 0;
	const baseButton = mouseBaseButton(packet.button);
	if (baseButton === 64) return WHEEL_SCROLL_LINES;
	if (baseButton === 65) return -WHEEL_SCROLL_LINES;
	return 0;
}

function isLeftPress(packet: SgrMousePacket): boolean {
	return packet.final === "M" && mouseBaseButton(packet.button) === 0 && (packet.button & 32) === 0;
}

function isLeftDrag(packet: SgrMousePacket): boolean {
	return packet.final === "M" && mouseBaseButton(packet.button) === 0 && (packet.button & 32) !== 0;
}

function isMouseRelease(packet: SgrMousePacket): boolean {
	return packet.final === "m";
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function sliceColumns(text: string, startCol: number, endCol: number): string {
	let col = 0;
	let result = "";
	for (const char of Array.from(text)) {
		const width = Math.max(0, visibleWidth(char));
		if (col >= startCol && col < endCol) result += char;
		col += width;
	}
	return result;
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function isJumpBottomInput(data: string): boolean {
	return data === JUMP_BOTTOM_INPUT || matchesKey(data, "ctrl+shift+g") || matchesKey(data, "ctrl+g");
}

function isJumpTopInput(data: string): boolean {
	return data === JUMP_TOP_INPUT || matchesKey(data, "ctrl+shift+t") || matchesKey(data, "ctrl+t");
}

export class TerminalSplitCompositor {
	private readonly originalTerminalWrite: TerminalLike["write"];
	private readonly originalTuiRender: TuiLike["render"];
	private readonly originalTuiDoRender?: () => void;
	private readonly originalRowsOwnDescriptor?: PropertyDescriptor;
	private readonly originalRowsDescriptor?: PropertyDescriptor;
	private readonly hadOwnRowsDescriptor: boolean;
	private scrollOffset = 0;
	private disposed = false;
	private painting = false;
	private lastRootLineCount = 0;
	private renderingCluster = false;
	private lastClusterHeight = 0;
	private clusterCache: { width: number; rawRows: number; stateKey: string; cluster: FixedZoneCluster } | undefined;
	private renderPassActive = false;
	private scrollRegionBottom = 0;
	private rootLines: string[] = [];
	private visibleRootStart = 0;
	private visibleScrollableRows = 0;
	private selectionAnchor: SelectionPoint | null = null;
	private selectionFocus: SelectionPoint | null = null;
	private selectionDragging = false;

	constructor(
		private readonly tui: TuiLike,
		private readonly hiddenRenderables: HiddenRenderable[],
		private readonly options: TerminalSplitOptions,
	) {
		this.originalTerminalWrite = tui.terminal.write;
		this.originalTuiRender = tui.render.bind(tui);
		this.originalTuiDoRender = typeof tui.doRender === "function" ? tui.doRender.bind(tui) : undefined;
		this.hadOwnRowsDescriptor = Object.prototype.hasOwnProperty.call(tui.terminal, "rows");
		this.originalRowsOwnDescriptor = Object.getOwnPropertyDescriptor(tui.terminal, "rows");
		this.originalRowsDescriptor = findPropertyDescriptor(tui.terminal, "rows");
	}

	install(): void {
		if (this.disposed) return;
		const terminal = this.tui.terminal;
		const rawRows = this.getRawRows();
		const cluster = this.refreshCluster(this.getRawColumns(), rawRows);
		this.syncScrollRegion(this.getScrollBottom(rawRows, cluster.lines.length));
		Object.defineProperty(terminal, "rows", {
			configurable: true,
			get: () => this.renderingCluster ? this.getRawRows() : this.getScrollableRows(),
		});
		this.tui.render = (width: number) => this.renderScrollableRoot(width);
		terminal.write = (data: string) => this.write(data);
		if (this.originalTuiDoRender) {
			this.tui.doRender = () => this.renderPass();
		}
		if (this.options.mouseScroll) {
			this.writeRaw(ENABLE_MOUSE);
		}
	}

	handleInput(data: string): { consume?: boolean; data?: string } | undefined {
		if (this.disposed) return undefined;
		let current = data;
		if (this.options.mouseScroll) {
			const mouseInput = parseMouseInput(current);
			if (mouseInput.packets.length > 0) {
				for (const packet of mouseInput.packets) this.handleMousePacket(packet);
				if (mouseInput.filtered.length === 0) return { consume: true };
				current = mouseInput.filtered;
			}
		}
		if (isJumpBottomInput(current)) {
			this.jumpToBottom();
			return { consume: true };
		}
		if (isJumpTopInput(current)) {
			this.jumpToTop();
			return { consume: true };
		}
		return current === data ? undefined : { data: current };
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.tui.terminal.write = this.originalTerminalWrite;
		this.tui.render = this.originalTuiRender;
		if (this.originalTuiDoRender) {
			this.tui.doRender = this.originalTuiDoRender;
		}
		if (this.hadOwnRowsDescriptor && this.originalRowsOwnDescriptor) {
			Object.defineProperty(this.tui.terminal, "rows", this.originalRowsOwnDescriptor);
		} else {
			delete (this.tui.terminal as any).rows;
		}
		if (this.options.mouseScroll) {
			this.writeRaw(DISABLE_MOUSE);
		}
		this.scrollRegionBottom = 0;
		this.writeRaw(setScrollRegion(1, Math.max(1, this.getRawRows())));
		this.tui.requestRender(true);
	}

	private writeRaw(data: string): void {
		this.originalTerminalWrite.call(this.tui.terminal, data);
	}

	private getRawRows(): number {
		const descriptor = this.originalRowsDescriptor;
		if (descriptor?.get) {
			const value = descriptor.get.call(this.tui.terminal);
			return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
		}
		const value = descriptor?.value;
		return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
	}

	private getRawColumns(): number {
		const value = this.tui.terminal.columns;
		return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
	}

	private getMaxClusterRows(rawRows = this.getRawRows()): number {
		return Math.max(0, rawRows - MIN_SCROLLABLE_ROWS);
	}

	private renderCluster(width = this.getRawColumns(), rawRows = this.getRawRows()): FixedZoneCluster {
		this.renderingCluster = true;
		try {
			return renderFixedUserZoneCluster(this.hiddenRenderables, width, this.getMaxClusterRows(rawRows), this.getClusterOptions());
		} finally {
			this.renderingCluster = false;
		}
	}

	private getClusterOptions(): FixedZoneClusterOptions {
		return this.scrollOffset > 0
			? { scrollHint: BOTTOM_HINT, showScrollDivider: true }
			: { scrollHint: TOP_HINT };
	}

	private getClusterStateKey(): string {
		return this.scrollOffset > 0 ? "scrolled" : "bottom";
	}

	private refreshCluster(width = this.getRawColumns(), rawRows = this.getRawRows()): FixedZoneCluster {
		const stateKey = this.getClusterStateKey();
		const cached = this.clusterCache;
		if (cached && cached.width === width && cached.rawRows === rawRows && cached.stateKey === stateKey) return cached.cluster;
		const cluster = this.renderCluster(width, rawRows);
		this.lastClusterHeight = cluster.lines.length;
		this.clusterCache = { width, rawRows, stateKey, cluster };
		return cluster;
	}

	private getScrollableRows(): number {
		if (this.disposed || this.painting || this.renderingCluster) return this.getRawRows();
		const rawRows = this.getRawRows();
		const cluster = this.refreshCluster(this.getRawColumns(), rawRows);
		return Math.max(1, rawRows - cluster.lines.length);
	}

	private getScrollBottom(rawRows: number, clusterHeight: number): number {
		return Math.max(1, clusterHeight > 0 ? rawRows - clusterHeight : rawRows);
	}

	private syncScrollRegion(scrollBottom: number): void {
		if (this.scrollRegionBottom === scrollBottom) return;
		this.scrollRegionBottom = scrollBottom;
		this.writeRaw(saveCursor() + setScrollRegion(1, scrollBottom) + restoreCursor());
	}

	private getTuiCursorScreenRow(scrollableRows: number): number {
		const state = this.tui as TuiLike & { hardwareCursorRow?: unknown; previousViewportTop?: unknown };
		const cursorRow = typeof state.hardwareCursorRow === "number" && Number.isFinite(state.hardwareCursorRow)
			? Math.floor(state.hardwareCursorRow)
			: 0;
		const viewportTop = typeof state.previousViewportTop === "number" && Number.isFinite(state.previousViewportTop)
			? Math.floor(state.previousViewportTop)
			: 0;
		return Math.max(1, Math.min(scrollableRows, cursorRow - viewportTop + 1));
	}

	private moveToTuiCursor(scrollableRows: number): void {
		this.writeRaw(moveCursor(this.getTuiCursorScreenRow(scrollableRows), 1));
	}

	private renderScrollableRoot(width: number): string[] {
		const rawRows = this.getRawRows();
		if (!this.renderPassActive) this.clusterCache = undefined;
		this.refreshCluster(width, rawRows);
		const scrollableRows = this.getScrollableRows();
		const lines = this.originalTuiRender(width);
		this.rootLines = lines;
		this.lastRootLineCount = lines.length;
		const maxOffset = Math.max(0, lines.length - scrollableRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const start = Math.max(0, maxOffset - this.scrollOffset);
		this.visibleRootStart = start;
		this.visibleScrollableRows = scrollableRows;
		return lines.slice(start, start + scrollableRows).map((line, index) => this.renderSelectionHighlight(line, start + index));
	}

	private getMaxScrollOffset(): number {
		return Math.max(0, this.lastRootLineCount - this.getScrollableRows());
	}

	private scrollBy(delta: number): void {
		const maxOffset = this.getMaxScrollOffset();
		this.clearSelection();
		this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
		this.tui.requestRender();
	}

	private jumpToTop(): void {
		this.clearSelection();
		this.scrollOffset = this.getMaxScrollOffset();
		this.tui.requestRender();
	}

	private jumpToBottom(): void {
		this.clearSelection();
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	private handleMousePacket(packet: SgrMousePacket): void {
		const delta = mouseScrollDelta(packet);
		if (delta !== 0) {
			this.scrollBy(delta);
			return;
		}

		if (isMouseRelease(packet)) {
			this.finishSelection(this.selectionPointForPacket(packet));
			return;
		}

		const point = this.selectionPointForPacket(packet);
		if (!point) {
			if (isLeftPress(packet)) this.clearSelection();
			return;
		}

		if (isLeftPress(packet)) {
			this.selectionAnchor = point;
			this.selectionFocus = point;
			this.selectionDragging = true;
			this.tui.requestRender();
			return;
		}

		if (this.selectionDragging && isLeftDrag(packet)) {
			this.selectionFocus = point;
			this.tui.requestRender();
		}
	}

	private selectionPointForPacket(packet: SgrMousePacket): SelectionPoint | null {
		if (packet.row < 1 || packet.row > this.visibleScrollableRows) return null;
		return {
			line: this.visibleRootStart + packet.row - 1,
			col: Math.max(0, packet.col - 1),
		};
	}

	private finishSelection(point: SelectionPoint | null): void {
		if (!this.selectionDragging) return;
		if (point) this.selectionFocus = point;
		this.selectionDragging = false;
		const selectedText = this.getSelectedText();
		if (selectedText) {
			this.options.onCopySelection?.(selectedText);
		} else {
			this.clearSelection();
		}
		this.tui.requestRender();
	}

	private clearSelection(): void {
		this.selectionAnchor = null;
		this.selectionFocus = null;
		this.selectionDragging = false;
	}

	private getSelectedText(): string {
		if (!this.selectionAnchor || !this.selectionFocus) return "";
		const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0 ? this.selectionAnchor : this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (start.line === end.line && start.col === end.col) return "";
		const selected: string[] = [];
		for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
			const line = stripAnsi(this.rootLines[lineIndex] ?? "");
			selected.push(sliceColumns(line, lineIndex === start.line ? start.col : 0, lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY));
		}
		return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
	}

	private renderSelectionHighlight(line: string, lineIndex: number): string {
		if (!this.selectionAnchor || !this.selectionFocus) return line;
		const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0 ? this.selectionAnchor : this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (lineIndex < start.line || lineIndex > end.line) return line;
		const plain = stripAnsi(line);
		const lineWidth = visibleWidth(plain);
		const startCol = lineIndex === start.line ? Math.max(0, Math.min(start.col, lineWidth)) : 0;
		const endCol = lineIndex === end.line ? Math.max(startCol, Math.min(end.col, lineWidth)) : lineWidth;
		if (startCol === endCol) return line;
		return `${sliceColumns(plain, 0, startCol)}\x1b[7m${sliceColumns(plain, startCol, endCol)}\x1b[27m${sliceColumns(plain, endCol, Number.POSITIVE_INFINITY)}`;
	}

	private renderPass(): void {
		if (!this.originalTuiDoRender) return;
		this.renderPassActive = true;
		this.clusterCache = undefined;
		try {
			this.originalTuiDoRender();
			this.requestRepaint();
		} finally {
			this.renderPassActive = false;
			this.clusterCache = undefined;
		}
	}

	private requestRepaint(): void {
		if (this.disposed || this.painting) return;
		const rawRows = this.getRawRows();
		const width = this.getRawColumns();
		const cluster = this.refreshCluster(width, rawRows);
		this.syncScrollRegion(this.getScrollBottom(rawRows, cluster.lines.length));
		if (cluster.lines.length === 0) return;
		this.painting = true;
		try {
			this.writeRaw(this.buildFixedClusterPaint(cluster, rawRows, width));
		} finally {
			this.painting = false;
		}
	}

	private write(data: string): void {
		if (this.painting || this.disposed) {
			this.writeRaw(data);
			return;
		}
		this.painting = true;
		try {
			const rawRows = this.getRawRows();
			const width = this.getRawColumns();
			const cluster = this.refreshCluster(width, rawRows);
			const clusterHeight = cluster.lines.length;
			if (clusterHeight === 0) {
				this.syncScrollRegion(this.getScrollBottom(rawRows, clusterHeight));
				this.writeRaw(data);
				return;
			}
			const scrollBottom = this.getScrollBottom(rawRows, clusterHeight);
			this.syncScrollRegion(scrollBottom);
			if (this.renderPassActive) this.moveToTuiCursor(scrollBottom);
			this.writeRaw(this.renderPassActive ? data : data + this.buildFixedClusterPaint(cluster, rawRows, width));
		} finally {
			this.painting = false;
		}
	}

	private buildFixedClusterPaint(cluster: FixedZoneCluster, rawRows: number, width: number): string {
		const startRow = rawRows - cluster.lines.length + 1;
		let output = saveCursor();
		cluster.lines.forEach((line, index) => {
			const row = startRow + index;
			output += moveCursor(row, 1) + clearLine() + fitLine(line, width);
		});
		if (cluster.cursor) {
			const cursorRow = startRow + cluster.cursor.row - 1;
			const cursorCol = Math.max(1, Math.min(width, cluster.cursor.col));
			return output + moveCursor(cursorRow, cursorCol);
		}
		return output + restoreCursor();
	}
}
