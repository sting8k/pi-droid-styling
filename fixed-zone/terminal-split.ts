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

function parseScrollInput(data: string): number {
	let delta = 0;
	for (const match of data.matchAll(/\x1b\[<(\d+);\d+;\d+[mM]/g)) {
		const button = Number(match[1]);
		if (!Number.isFinite(button) || button < 64) continue;
		const wheelButton = button & 1;
		delta += wheelButton === 0 ? WHEEL_SCROLL_LINES : -WHEEL_SCROLL_LINES;
	}
	if (delta !== 0) return delta;
	return 0;
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
		this.refreshCluster(this.getRawColumns(), this.getRawRows());
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

	handleInput(data: string): { consume?: boolean } | undefined {
		if (this.disposed) return undefined;
		if (isJumpBottomInput(data)) {
			this.jumpToBottom();
			return { consume: true };
		}
		if (isJumpTopInput(data)) {
			this.jumpToTop();
			return { consume: true };
		}
		const delta = parseScrollInput(data);
		if (delta === 0) return undefined;
		this.scrollBy(delta);
		return { consume: true };
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

	private renderScrollableRoot(width: number): string[] {
		const rawRows = this.getRawRows();
		if (!this.renderPassActive) this.clusterCache = undefined;
		this.refreshCluster(width, rawRows);
		const scrollableRows = this.getScrollableRows();
		const lines = this.originalTuiRender(width);
		this.lastRootLineCount = lines.length;
		const maxOffset = Math.max(0, lines.length - scrollableRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const start = Math.max(0, maxOffset - this.scrollOffset);
		return lines.slice(start, start + scrollableRows);
	}

	private getMaxScrollOffset(): number {
		return Math.max(0, this.lastRootLineCount - this.getScrollableRows());
	}

	private scrollBy(delta: number): void {
		const maxOffset = this.getMaxScrollOffset();
		this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
		this.tui.requestRender();
	}

	private jumpToTop(): void {
		this.scrollOffset = this.getMaxScrollOffset();
		this.tui.requestRender();
	}

	private jumpToBottom(): void {
		this.scrollOffset = 0;
		this.tui.requestRender();
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
				this.writeRaw(data);
				return;
			}
			const scrollBottom = Math.max(1, rawRows - clusterHeight);
			const scopedWrite = setScrollRegion(1, scrollBottom) + data;
			this.writeRaw(this.renderPassActive ? scopedWrite : scopedWrite + this.buildFixedClusterPaint(cluster, rawRows, width));
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
