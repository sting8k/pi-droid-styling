import { matchesKey } from "@earendil-works/pi-tui";
import { profileCount, profileDuration, profileNow, profileSample, profileTextBytes } from "../performance/profiler.js";
import { isVirtualizedChatContainer } from "../performance/virtualize-chat.js";
import { MAX_FIXED_ROOT_LINES, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";

import { type FixedZoneCluster, type FixedZoneClusterOptions, type HiddenRenderable, renderFixedUserZoneCluster } from "./cluster.js";
import { computeFixedZoneSidebarLayout, renderFixedZoneSidebar, type FixedZoneSidebarInfoProvider, type FixedZoneSidebarLayout, type FixedZoneSidebarTheme } from "./sidebar.js";

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

interface RenderableLike {
	render(width: number): string[];
	children?: RenderableLike[];
	constructor?: { name?: string };
}

type WindowedRootRender = {
	lines: string[];
	omitted: boolean;
	renderedComponents: number;
	skippedComponents: number;
	truncatedLines: number;
	visitedComponents: number;
};

const WINDOWABLE_CONTAINER_NAMES = new Set(["Container", "TUI"]);

function isRenderable(value: unknown): value is RenderableLike {
	return typeof value === "object" && value !== null && typeof (value as RenderableLike).render === "function";
}

export interface TerminalSplitOptions {
	onCopySelection?: (text: string) => void;
	sidebar?: {
		enabled: boolean;
		getInfo?: FixedZoneSidebarInfoProvider;
		theme?: FixedZoneSidebarTheme;
		onActiveChange?: (active: boolean) => void;
	};
}
interface SgrMousePacket {
	button: number;
	col: number;
	row: number;
	final: "M" | "m";
}

interface SelectionPoint {
	region: "root" | "sidebar";
	line: number;
	col: number;
}

type SidebarRowsCache = {
	rawRows: number;
	sidebarWidth: number;
	selectionKey: string;
	rows: string[];
	renderedRows: string[];
};

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
	if (safeVisibleWidth(line) <= width) return line;
	return safeTruncateToWidth(line, width, "");
}

function padLine(line: string, width: number): string {
	const fitted = fitLine(line, width);
	return `${fitted}${" ".repeat(Math.max(0, width - safeVisibleWidth(fitted)))}`;
}

const SGR_MOUSE_EVENT_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const TRAILING_SGR_MOUSE_EVENT_PREFIX_PATTERN = /\x1b\[<\d*(?:;\d*(?:;\d*)?)?$/;

function splitTrailingSgrMousePrefix(data: string): { body: string; pending: string } {
	const match = data.match(TRAILING_SGR_MOUSE_EVENT_PREFIX_PATTERN);
	if (!match || match.index === undefined) return { body: data, pending: "" };
	return { body: data.slice(0, match.index), pending: match[0] };
}

function parseMouseInput(data: string): { packets: SgrMousePacket[]; filtered: string; pending: string } {
	const { body, pending } = splitTrailingSgrMousePrefix(data);
	const packets: SgrMousePacket[] = [];
	const filtered = body.replace(SGR_MOUSE_EVENT_PATTERN, (_event, buttonText: string, colText: string, rowText: string, finalText: string) => {
		const button = Number(buttonText);
		const col = Number(colText);
		const row = Number(rowText);
		if (Number.isFinite(button) && Number.isFinite(col) && Number.isFinite(row)) {
			packets.push({ button, col, row, final: finalText as "M" | "m" });
		}
		return "";
	});
	return { packets, filtered, pending };
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
		const width = Math.max(0, safeVisibleWidth(char));
		if (col >= startCol && col < endCol) result += char;
		col += width;
	}
	return result;
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
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
	private readonly hiddenRenderableTargets: WeakSet<object>;
	private readonly originalRowsOwnDescriptor?: PropertyDescriptor;
	private readonly originalRowsDescriptor?: PropertyDescriptor;
	private readonly hadOwnRowsDescriptor: boolean;
	private scrollOffset = 0;
	private lastRenderedScrollOffset = 0;
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
	private pendingMouseInput = "";
	private sidebarActive = false;
	private sidebarRows: string[] = [];
	private sidebarRowsCache: SidebarRowsCache | undefined;
	private lastPaintedSidebarKey = "";
	private lastPaintedSidebarRows: string[] = [];
	private lastPaintedClusterKey = "";
	private lastPaintedClusterRows: string[] = [];

	constructor(
		private readonly tui: TuiLike,
		private readonly hiddenRenderables: HiddenRenderable[],
		private readonly options: TerminalSplitOptions,
	) {
		this.originalTerminalWrite = tui.terminal.write;
		this.originalTuiRender = tui.render.bind(tui);
		this.originalTuiDoRender = typeof tui.doRender === "function" ? tui.doRender.bind(tui) : undefined;
		this.hiddenRenderableTargets = new WeakSet(hiddenRenderables.map((renderable) => renderable.target as object));
		this.hadOwnRowsDescriptor = Object.prototype.hasOwnProperty.call(tui.terminal, "rows");
		this.originalRowsOwnDescriptor = Object.getOwnPropertyDescriptor(tui.terminal, "rows");
		this.originalRowsDescriptor = findPropertyDescriptor(tui.terminal, "rows");
	}

	install(): void {
		if (this.disposed) return;
		const terminal = this.tui.terminal;
		const rawRows = this.getRawRows();
		const layout = this.getSidebarLayout(this.getRawColumns());
		const cluster = this.refreshCluster(layout.contentWidth, rawRows);
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
		this.writeRaw(ENABLE_MOUSE);
	}

	handleInput(data: string): { consume?: boolean; data?: string } | undefined {
		if (this.disposed) return undefined;
		let current = data;
		const mouseInput = parseMouseInput(this.pendingMouseInput + current);
		this.pendingMouseInput = mouseInput.pending;
		for (const packet of mouseInput.packets) this.handleMousePacket(packet);
		current = mouseInput.filtered;
		if (current.length === 0 && (mouseInput.packets.length > 0 || mouseInput.pending.length > 0)) return { consume: true };
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
		this.pendingMouseInput = "";
		this.setSidebarActive(false);
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
		this.writeRaw(DISABLE_MOUSE);
		this.scrollRegionBottom = 0;
		this.writeRaw(setScrollRegion(1, Math.max(1, this.getRawRows())));
		this.tui.requestRender(true);
	}

	private writeRaw(data: string): void {
		profileCount("terminal.write.raw.calls");
		profileTextBytes("terminal.write.raw.bytes", data);
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

	private setSidebarActive(active: boolean): void {
		if (this.sidebarActive === active) return;
		profileCount(active ? "fixed.sidebar.active.on" : "fixed.sidebar.active.off");
		this.sidebarActive = active;
		if (!active && this.selectionAnchor?.region === "sidebar") this.clearSelection();
		this.clusterCache = undefined;
		this.sidebarRowsCache = undefined;
		this.resetSidebarPaintCache();
		this.resetClusterPaintCache();
		this.options.sidebar?.onActiveChange?.(active);
	}

	private getSidebarLayout(rawWidth = this.getRawColumns()): FixedZoneSidebarLayout {
		const layout = computeFixedZoneSidebarLayout(rawWidth, this.options.sidebar?.enabled === true);
		this.setSidebarActive(layout.active);
		return layout;
	}

	private sidebarSelectionKey(): string {
		if (!this.selectionAnchor || !this.selectionFocus || this.selectionAnchor.region !== "sidebar" || this.selectionFocus.region !== "sidebar") return "none";
		return `${this.selectionAnchor.line}:${this.selectionAnchor.col}:${this.selectionFocus.line}:${this.selectionFocus.col}`;
	}

	private resetSidebarPaintCache(): void {
		this.lastPaintedSidebarKey = "";
		this.lastPaintedSidebarRows = [];
	}

	private resetClusterPaintCache(): void {
		this.lastPaintedClusterKey = "";
		this.lastPaintedClusterRows = [];
	}

	private markSidebarPaintDirty(layout: FixedZoneSidebarLayout, data: string): void {
		// TUI diff rendering can use CR/LF or line clears inside the scroll region,
		// which mutates sidebar cells even when the sidebar data itself is unchanged.
		if (layout.active && data.length > 0) {
			profileCount("fixed.sidebar.paint.dirty.coreWrite");
			this.resetSidebarPaintCache();
		}
	}

	private markClusterPaintDirty(data: string): void {
		// A forced TUI render clears the full terminal (`2J`/`3J`) before drawing
		// the scrollable root. The fixed cluster is painted out-of-band after that;
		// if its rows are unchanged, the paint cache would otherwise skip repainting
		// and `/new` can leave the user zone/footer blank until the next input.
		if (data.length > 0 && (data.includes("\x1b[2J") || data.includes("\x1b[3J") || data.includes("\x1bc"))) {
			profileCount("fixed.cluster.paint.dirty.coreClear");
			this.resetClusterPaintCache();
		}
	}

	private renderSidebarRows(layout: FixedZoneSidebarLayout, rawRows: number): string[] {
		if (!layout.active) {
			this.sidebarRows = [];
			this.sidebarRowsCache = undefined;
			return [];
		}
		const selectionKey = this.sidebarSelectionKey();
		const cached = this.sidebarRowsCache;
		if (cached && cached.rawRows === rawRows && cached.sidebarWidth === layout.sidebarWidth && cached.selectionKey === selectionKey) {
			profileCount("fixed.sidebar.rows.cacheHit");
			this.sidebarRows = cached.rows;
			return cached.renderedRows;
		}
		profileCount("fixed.sidebar.rows.cacheMiss");
		const totalStart = profileNow();
		const infoStart = profileNow();
		const info = this.options.sidebar?.getInfo?.();
		profileDuration("fixed.sidebar.info.ms", infoStart);
		const renderStart = profileNow();
		const rows = renderFixedZoneSidebar(info, layout.sidebarWidth, rawRows, this.options.sidebar?.theme);
		profileDuration("fixed.sidebar.rows.render.ms", renderStart);
		const highlightStart = profileNow();
		const renderedRows = rows.map((line, index) => this.renderSidebarSelectionHighlight(line, index));
		profileDuration("fixed.sidebar.rows.highlight.ms", highlightStart);
		profileSample("fixed.sidebar.rows.count", rows.length);
		profileDuration("fixed.sidebar.rows.total.ms", totalStart);
		this.sidebarRows = rows;
		this.sidebarRowsCache = { rawRows, sidebarWidth: layout.sidebarWidth, selectionKey, rows, renderedRows };
		return renderedRows;
	}

	private composeWithSidebar(content: string, layout: FixedZoneSidebarLayout, sidebarRows: string[], rowIndex: number): string {
		if (!layout.active) return fitLine(content, layout.contentWidth);
		return `${padLine(content, layout.contentWidth)}${sidebarRows[rowIndex] ?? ""}`;
	}

	private getMaxClusterRows(rawRows = this.getRawRows()): number {
		return Math.max(0, rawRows - MIN_SCROLLABLE_ROWS);
	}

	private renderCluster(width = this.getSidebarLayout().contentWidth, rawRows = this.getRawRows()): FixedZoneCluster {
		const start = profileNow();
		this.renderingCluster = true;
		try {
			const cluster = renderFixedUserZoneCluster(this.hiddenRenderables, width, this.getMaxClusterRows(rawRows), this.getClusterOptions());
			profileSample("fixed.cluster.rows.count", cluster.lines.length);
			return cluster;
		} finally {
			this.renderingCluster = false;
			profileDuration("fixed.cluster.render.ms", start);
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

	private refreshCluster(width = this.getSidebarLayout().contentWidth, rawRows = this.getRawRows()): FixedZoneCluster {
		const stateKey = this.getClusterStateKey();
		const cached = this.clusterCache;
		if (cached && cached.width === width && cached.rawRows === rawRows && cached.stateKey === stateKey) {
			profileCount("fixed.cluster.cacheHit");
			return cached.cluster;
		}
		profileCount("fixed.cluster.cacheMiss");
		const cluster = this.renderCluster(width, rawRows);
		this.lastClusterHeight = cluster.lines.length;
		this.clusterCache = { width, rawRows, stateKey, cluster };
		return cluster;
	}

	private getScrollableRows(): number {
		if (this.disposed || this.painting || this.renderingCluster) return this.getRawRows();
		const rawRows = this.getRawRows();
		const layout = this.getSidebarLayout(this.getRawColumns());
		const cluster = this.refreshCluster(layout.contentWidth, rawRows);
		return Math.max(1, rawRows - cluster.lines.length);
	}

	private getScrollBottom(rawRows: number, clusterHeight: number): number {
		return Math.max(1, clusterHeight > 0 ? rawRows - clusterHeight : rawRows);
	}

	private syncScrollRegion(scrollBottom: number): void {
		if (this.scrollRegionBottom === scrollBottom) return;
		profileCount("fixed.scrollRegion.changed");
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

	private getWindowableChildren(component: RenderableLike, isRoot = false): RenderableLike[] | null {
		if (!Array.isArray(component.children)) return null;
		if (isRoot) return component.children.filter(isRenderable);
		if (isVirtualizedChatContainer(component)) {
			profileCount("fixed.root.windowRender.virtualizedChatLeaf");
			return null;
		}
		const constructorName = component.constructor?.name ?? "";
		return WINDOWABLE_CONTAINER_NAMES.has(constructorName) ? component.children.filter(isRenderable) : null;
	}

	private renderTailComponent(component: RenderableLike, width: number, maxLines: number, isRoot = false): WindowedRootRender {
		if (maxLines <= 0) {
			return { lines: [], omitted: true, renderedComponents: 0, skippedComponents: 1, truncatedLines: 0, visitedComponents: 0 };
		}

		if (this.hiddenRenderableTargets.has(component as object)) {
			profileCount("fixed.root.windowRender.skipHiddenTarget");
			return { lines: [], omitted: false, renderedComponents: 0, skippedComponents: 0, truncatedLines: 0, visitedComponents: 1 };
		}

		const children = this.getWindowableChildren(component, isRoot);
		if (!children) {
			const rendered = component.render(width);
			const truncatedLines = Math.max(0, rendered.length - maxLines);
			return {
				lines: truncatedLines > 0 ? rendered.slice(-maxLines) : rendered,
				omitted: truncatedLines > 0,
				renderedComponents: 1,
				skippedComponents: 0,
				truncatedLines,
				visitedComponents: 1,
			};
		}

		const chunks: string[][] = [];
		let lineCount = 0;
		let omitted = false;
		let renderedComponents = 0;
		let skippedComponents = 0;
		let truncatedLines = 0;
		let visitedComponents = 1;

		for (let index = children.length - 1; index >= 0; index--) {
			if (lineCount >= maxLines) {
				omitted = true;
				skippedComponents += index + 1;
				break;
			}

			const child = children[index];
			const childResult = this.renderTailComponent(child, width, maxLines - lineCount);
			if (childResult.lines.length > 0) {
				chunks.push(childResult.lines);
				lineCount += childResult.lines.length;
			}
			omitted = omitted || childResult.omitted;
			renderedComponents += childResult.renderedComponents;
			skippedComponents += childResult.skippedComponents;
			truncatedLines += childResult.truncatedLines;
			visitedComponents += childResult.visitedComponents;
		}

		chunks.reverse();
		return {
			lines: chunks.flat(),
			omitted,
			renderedComponents,
			skippedComponents,
			truncatedLines,
			visitedComponents,
		};
	}

	private renderWindowedRoot(width: number, maxLines: number): WindowedRootRender | null {
		const root = this.tui as unknown as RenderableLike;
		if (!Array.isArray(root.children)) return null;
		return this.renderTailComponent(root, width, maxLines, true);
	}

	private rootOmittedMarker(windowed: WindowedRootRender, width: number): string {
		const skippedText = windowed.skippedComponents > 0 ? `; ${windowed.skippedComponents} earlier components skipped` : "";
		const truncatedText = windowed.truncatedLines > 0 ? `; ${windowed.truncatedLines} lines trimmed inside render window` : "";
		return safeTruncateToWidth(`… earlier root content omitted before render${skippedText}${truncatedText}`, width, "…");
	}

	private findVisibleAnchor(lines: string[], start: number, rowCount: number): { line: string; relativeRow: number } | null {
		const end = Math.min(lines.length, start + Math.max(1, rowCount));
		for (let index = start; index < end; index++) {
			const line = lines[index];
			if (line !== undefined && stripAnsi(line).trim().length > 0) {
				return { line, relativeRow: index - start };
			}
		}
		return lines[start] !== undefined ? { line: lines[start], relativeRow: 0 } : null;
	}

	private updateScrollAnchor(
		lines: string[],
		scrollableRows: number,
		previousLines: string[],
		previousStart: number,
		previousRows: number,
		previousOffset: number,
	): number {
		const maxOffset = Math.max(0, lines.length - scrollableRows);
		const offsetChangedSinceRender = previousOffset !== this.lastRenderedScrollOffset;
		if (offsetChangedSinceRender || previousLines.length === 0) {
			this.scrollOffset = Math.max(0, Math.min(previousOffset, maxOffset));
			this.lastRenderedScrollOffset = this.scrollOffset;
			profileCount(this.scrollOffset > 0 ? "fixed.scrollAnchor.manualOffset" : "fixed.scrollAnchor.followBottom");
			return Math.max(0, maxOffset - this.scrollOffset);
		}

		if (previousOffset <= 0) {
			this.scrollOffset = 0;
			this.lastRenderedScrollOffset = this.scrollOffset;
			profileCount("fixed.scrollAnchor.followBottom");
			return maxOffset;
		}

		let start = previousStart;
		const anchor = this.findVisibleAnchor(previousLines, previousStart, previousRows || scrollableRows);
		if (anchor) {
			const searchFrom = Math.max(0, Math.min(previousStart, Math.max(0, lines.length - 1)));
			let anchorIndex = lines.indexOf(anchor.line, searchFrom);
			if (anchorIndex < 0) anchorIndex = lines.indexOf(anchor.line);
			if (anchorIndex >= 0) {
				start = anchorIndex - anchor.relativeRow;
				profileCount("fixed.scrollAnchor.anchorHit");
			} else {
				profileCount("fixed.scrollAnchor.anchorMiss");
			}
		} else {
			profileCount("fixed.scrollAnchor.anchorUnavailable");
		}

		start = Math.max(0, Math.min(start, maxOffset));
		this.scrollOffset = maxOffset - start;
		this.lastRenderedScrollOffset = this.scrollOffset;
		profileCount("fixed.scrollAnchor.preserved");
		profileSample("fixed.scrollAnchor.offset", this.scrollOffset);
		return start;
	}

	private renderScrollableRoot(_width: number): string[] {
		const totalStart = profileNow();
		try {
			const previousRootLines = this.rootLines;
			const previousVisibleRootStart = this.visibleRootStart;
			const previousVisibleScrollableRows = this.visibleScrollableRows;
			const previousScrollOffset = this.scrollOffset;
			const rawRows = this.getRawRows();
			const layout = this.getSidebarLayout(this.getRawColumns());
			if (!this.renderPassActive) {
				this.clusterCache = undefined;
				this.sidebarRowsCache = undefined;
			}
			this.refreshCluster(layout.contentWidth, rawRows);
			const scrollableRows = this.getScrollableRows();
			const retainedLines = Math.max(1, MAX_FIXED_ROOT_LINES - 1);
			const rootRenderStart = profileNow();
			let lines: string[];
			let omittedLines = 0;
			try {
				const windowed = this.renderWindowedRoot(layout.contentWidth, retainedLines);
				if (windowed) {
					profileCount("fixed.root.windowRender.used");
					profileDuration("fixed.root.windowRender.ms", rootRenderStart);
					profileSample("fixed.root.windowRender.renderedComponents.count", windowed.renderedComponents);
					profileSample("fixed.root.windowRender.skippedComponents.count", windowed.skippedComponents);
					profileSample("fixed.root.windowRender.visitedComponents.count", windowed.visitedComponents);
					profileSample("fixed.root.windowRender.truncatedLines.count", windowed.truncatedLines);
					profileSample("fixed.root.windowRender.omitted.count", windowed.omitted ? 1 : 0);
					profileSample("fixed.root.windowRender.omittedUnits.count", windowed.omitted ? windowed.skippedComponents + windowed.truncatedLines : 0);
					omittedLines = windowed.omitted ? windowed.truncatedLines : 0;
					lines = windowed.omitted ? [this.rootOmittedMarker(windowed, layout.contentWidth), ...windowed.lines] : windowed.lines;
				} else {
					profileCount("fixed.root.windowRender.fallback.noChildren");
					const renderedLines = this.originalTuiRender(layout.contentWidth);
					profileDuration("fixed.root.originalRender.ms", rootRenderStart);
					profileSample("fixed.root.originalLines.count", renderedLines.length);
					omittedLines = Math.max(0, renderedLines.length - retainedLines);
					lines = omittedLines > 0
						? [
							safeTruncateToWidth(`… ${omittedLines} earlier rendered lines omitted`, layout.contentWidth, "…"),
							...renderedLines.slice(-retainedLines),
						]
						: renderedLines;
				}
			} catch {
				profileCount("fixed.root.windowRender.fallback.error");
				const fallbackStart = profileNow();
				const renderedLines = this.originalTuiRender(layout.contentWidth);
				profileDuration("fixed.root.originalRender.ms", fallbackStart);
				profileSample("fixed.root.originalLines.count", renderedLines.length);
				omittedLines = Math.max(0, renderedLines.length - retainedLines);
				lines = omittedLines > 0
					? [
						safeTruncateToWidth(`… ${omittedLines} earlier rendered lines omitted`, layout.contentWidth, "…"),
						...renderedLines.slice(-retainedLines),
					]
					: renderedLines;
			}
			profileSample("fixed.root.lines.count", lines.length);
			profileSample("fixed.root.retainedLines.count", lines.length);
			profileSample("fixed.root.omittedLines.count", omittedLines);
			this.rootLines = lines;
			this.lastRootLineCount = lines.length;
			const start = this.updateScrollAnchor(
				lines,
				scrollableRows,
				previousRootLines,
				previousVisibleRootStart,
				previousVisibleScrollableRows,
				previousScrollOffset,
			);
			this.visibleRootStart = start;
			this.visibleScrollableRows = scrollableRows;
			const visibleStart = profileNow();
			const visibleLines = lines.slice(start, start + scrollableRows)
				.map((line, index) => this.renderSelectionHighlight(line, start + index));
			profileDuration("fixed.root.visibleLines.ms", visibleStart);
			profileSample("fixed.root.visibleRows.count", visibleLines.length);
			if (!layout.active) return visibleLines;
			const sidebarRows = this.renderSidebarRows(layout, rawRows);
			const composeStart = profileNow();
			const composed = visibleLines.map((line, index) => this.composeWithSidebar(line, layout, sidebarRows, index));
			profileDuration("fixed.root.composeSidebar.ms", composeStart);
			return composed;
		} finally {
			profileDuration("fixed.root.renderScrollable.ms", totalStart);
		}
	}

	private getMaxScrollOffset(): number {
		return Math.max(0, this.lastRootLineCount - this.getScrollableRows());
	}

	private scrollBy(delta: number): void {
		profileCount("fixed.input.scrollBy.calls");
		profileSample("fixed.input.scrollBy.delta", delta);
		const maxOffset = this.getMaxScrollOffset();
		this.clearSelection();
		this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
		this.tui.requestRender();
	}

	private jumpToTop(): void {
		profileCount("fixed.input.jumpTop.calls");
		this.clearSelection();
		this.scrollOffset = this.getMaxScrollOffset();
		this.tui.requestRender();
	}

	private jumpToBottom(): void {
		profileCount("fixed.input.jumpBottom.calls");
		this.clearSelection();
		this.scrollOffset = 0;
		this.tui.requestRender();
	}

	private handleMousePacket(packet: SgrMousePacket): void {
		const delta = mouseScrollDelta(packet);
		if (delta !== 0) {
			profileCount("fixed.input.mouseScroll.calls");
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
			profileCount("fixed.input.selection.start");
			this.selectionAnchor = point;
			this.selectionFocus = point;
			this.selectionDragging = true;
			this.tui.requestRender();
			return;
		}

		if (this.selectionDragging && isLeftDrag(packet) && this.selectionAnchor?.region === point.region) {
			if (this.selectionFocus && compareSelectionPoints(this.selectionFocus, point) === 0) {
				profileCount("fixed.input.selection.dragNoop");
				return;
			}
			profileCount("fixed.input.selection.dragRender");
			this.selectionFocus = point;
			this.tui.requestRender();
		}
	}

	private selectionPointForPacket(packet: SgrMousePacket): SelectionPoint | null {
		const layout = this.getSidebarLayout(this.getRawColumns());
		if (layout.active && packet.col > layout.contentWidth) {
			if (packet.row < 1 || packet.row > this.getRawRows()) return null;
			return {
				region: "sidebar",
				line: packet.row - 1,
				col: Math.max(0, packet.col - layout.contentWidth - 1),
			};
		}
		if (packet.row < 1 || packet.row > this.visibleScrollableRows) return null;
		return {
			region: "root",
			line: this.visibleRootStart + packet.row - 1,
			col: Math.max(0, packet.col - 1),
		};
	}

	private finishSelection(point: SelectionPoint | null): void {
		if (!this.selectionDragging) return;
		profileCount("fixed.input.selection.finish");
		if (point && this.selectionAnchor?.region === point.region) this.selectionFocus = point;
		this.selectionDragging = false;
		const selectedText = this.getSelectedText();
		if (selectedText) {
			profileCount("fixed.input.selection.copy");
			this.options.onCopySelection?.(selectedText);
		} else {
			profileCount("fixed.input.selection.empty");
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
		if (this.selectionAnchor.region !== this.selectionFocus.region) return "";
		const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0 ? this.selectionAnchor : this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (start.line === end.line && start.col === end.col) return "";
		const sourceLines = start.region === "sidebar" ? this.sidebarRows : this.rootLines;
		const selected: string[] = [];
		for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
			const line = stripAnsi(sourceLines[lineIndex] ?? "");
			selected.push(sliceColumns(line, lineIndex === start.line ? start.col : 0, lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY));
		}
		return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
	}

	private renderSelectionHighlight(line: string, lineIndex: number): string {
		if (!this.selectionAnchor || !this.selectionFocus || this.selectionAnchor.region !== "root" || this.selectionFocus.region !== "root") return line;
		return this.renderLineSelectionHighlight(line, lineIndex);
	}

	private renderSidebarSelectionHighlight(line: string, lineIndex: number): string {
		if (!this.selectionAnchor || !this.selectionFocus || this.selectionAnchor.region !== "sidebar" || this.selectionFocus.region !== "sidebar") return line;
		return this.renderLineSelectionHighlight(line, lineIndex);
	}

	private renderLineSelectionHighlight(line: string, lineIndex: number): string {
		if (!this.selectionAnchor || !this.selectionFocus) return line;
		const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0 ? this.selectionAnchor : this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (lineIndex < start.line || lineIndex > end.line) return line;
		const plain = stripAnsi(line);
		const lineWidth = safeVisibleWidth(plain);
		const startCol = lineIndex === start.line ? Math.max(0, Math.min(start.col, lineWidth)) : 0;
		const endCol = lineIndex === end.line ? Math.max(startCol, Math.min(end.col, lineWidth)) : lineWidth;
		if (startCol === endCol) return line;
		return `${sliceColumns(plain, 0, startCol)}\x1b[7m${sliceColumns(plain, startCol, endCol)}\x1b[27m${sliceColumns(plain, endCol, Number.POSITIVE_INFINITY)}`;
	}

	private renderPass(): void {
		profileCount("fixed.renderPass.calls");
		const totalStart = profileNow();
		try {
			if (!this.originalTuiDoRender) return;
			this.renderPassActive = true;
			this.clusterCache = undefined;
			this.sidebarRowsCache = undefined;
			try {
				const doRenderStart = profileNow();
				this.originalTuiDoRender();
				profileDuration("tui.doRender.ms", doRenderStart);
				this.requestRepaint();
			} finally {
				this.renderPassActive = false;
				this.clusterCache = undefined;
				this.sidebarRowsCache = undefined;
			}
		} finally {
			profileDuration("fixed.renderPass.ms", totalStart);
		}
	}

	private requestRepaint(): void {
		profileCount("fixed.repaint.request.calls");
		const totalStart = profileNow();
		try {
			if (this.disposed || this.painting) {
				profileCount("fixed.repaint.skip.busy");
				return;
			}
			const rawRows = this.getRawRows();
			const layout = this.getSidebarLayout(this.getRawColumns());
			const cluster = this.refreshCluster(layout.contentWidth, rawRows);
			const sidebarRows = this.renderSidebarRows(layout, rawRows);
			this.syncScrollRegion(this.getScrollBottom(rawRows, cluster.lines.length));
			if (cluster.lines.length === 0 && !layout.active) {
				profileCount("fixed.repaint.skip.empty");
				return;
			}
			this.painting = true;
			try {
				const output = this.buildSidebarPaint(rawRows, layout, sidebarRows) + this.buildFixedClusterPaint(cluster, rawRows, layout, sidebarRows);
				if (output.length === 0) {
					profileCount("fixed.repaint.skip.unchanged");
					return;
				}
				profileTextBytes("fixed.repaint.output.bytes", output);
				this.writeRaw(output);
			} finally {
				this.painting = false;
			}
		} finally {
			profileDuration("fixed.repaint.total.ms", totalStart);
		}
	}

	private write(data: string): void {
		profileCount("fixed.write.core.calls");
		profileTextBytes("fixed.write.core.bytes", data);
		const totalStart = profileNow();
		try {
			if (this.painting || this.disposed) {
				profileCount("fixed.write.core.bypass");
				this.writeRaw(data);
				return;
			}
			this.painting = true;
			if (!this.renderPassActive) this.sidebarRowsCache = undefined;
			try {
				const rawRows = this.getRawRows();
				const layout = this.getSidebarLayout(this.getRawColumns());
				const cluster = this.refreshCluster(layout.contentWidth, rawRows);
				this.markSidebarPaintDirty(layout, data);
				this.markClusterPaintDirty(data);
				const clusterHeight = cluster.lines.length;
				if (clusterHeight === 0) {
					const sidebarRows = this.renderSidebarRows(layout, rawRows);
					this.syncScrollRegion(this.getScrollBottom(rawRows, clusterHeight));
					const output = data + this.buildSidebarPaint(rawRows, layout, sidebarRows);
					profileTextBytes("fixed.write.output.bytes", output);
					this.writeRaw(output);
					return;
				}
				const scrollBottom = this.getScrollBottom(rawRows, clusterHeight);
				this.syncScrollRegion(scrollBottom);
				if (this.renderPassActive) {
					profileCount("fixed.write.core.renderPassOnly");
					this.moveToTuiCursor(scrollBottom);
					this.writeRaw(data);
					return;
				}
				const sidebarRows = this.renderSidebarRows(layout, rawRows);
				const output = data + this.buildSidebarPaint(rawRows, layout, sidebarRows) + this.buildFixedClusterPaint(cluster, rawRows, layout, sidebarRows);
				profileTextBytes("fixed.write.output.bytes", output);
				this.writeRaw(output);
			} finally {
				this.painting = false;
				if (!this.renderPassActive) this.sidebarRowsCache = undefined;
			}
		} finally {
			profileDuration("fixed.write.core.ms", totalStart);
		}
	}

	private buildSidebarPaint(rawRows: number, layout: FixedZoneSidebarLayout, sidebarRows = this.renderSidebarRows(layout, rawRows)): string {
		const start = profileNow();
		try {
			if (!layout.active) {
				this.resetSidebarPaintCache();
				return "";
			}
			const blankSidebarRow = " ".repeat(layout.sidebarWidth);
			const paintRows = Array.from({ length: rawRows }, (_value, index) => sidebarRows[index] ?? blankSidebarRow);
			const paintKey = `${rawRows}:${layout.contentWidth}:${layout.sidebarWidth}`;
			if (this.lastPaintedSidebarKey === paintKey && sameStringList(this.lastPaintedSidebarRows, paintRows)) {
				profileCount("fixed.sidebar.paint.skipUnchanged");
				return "";
			}
			this.lastPaintedSidebarKey = paintKey;
			this.lastPaintedSidebarRows = paintRows;
			let output = saveCursor();
			for (let row = 1; row <= rawRows; row++) {
				output += moveCursor(row, layout.contentWidth + 1) + paintRows[row - 1];
			}
			const painted = output + restoreCursor();
			profileCount("fixed.sidebar.paint.full");
			profileSample("fixed.sidebar.paint.rows.count", rawRows);
			profileTextBytes("fixed.sidebar.paint.bytes", painted);
			return painted;
		} finally {
			profileDuration("fixed.sidebar.paint.ms", start);
		}
	}

	private buildFixedClusterPaint(cluster: FixedZoneCluster, rawRows: number, layout: FixedZoneSidebarLayout, sidebarRows = this.renderSidebarRows(layout, rawRows)): string {
		const start = profileNow();
		try {
			if (cluster.lines.length === 0) {
				this.resetClusterPaintCache();
				return "";
			}
			const startRow = rawRows - cluster.lines.length + 1;
			const paintRows = cluster.lines.map((line, index) => this.composeWithSidebar(line, layout, sidebarRows, startRow + index - 1));
			const paintKey = `${rawRows}:${layout.contentWidth}:${layout.sidebarWidth}:${layout.active ? 1 : 0}:${startRow}`;
			const cursorPaint = cluster.cursor
				? moveCursor(startRow + cluster.cursor.row - 1, Math.max(1, Math.min(layout.contentWidth, cluster.cursor.col)))
				: "";
			if (this.lastPaintedClusterKey === paintKey && sameStringList(this.lastPaintedClusterRows, paintRows)) {
				profileCount("fixed.cluster.paint.skipUnchanged");
				if (cursorPaint) {
					profileCount("fixed.cluster.paint.cursorOnly");
					profileTextBytes("fixed.cluster.paint.cursorBytes", cursorPaint);
				}
				return cursorPaint;
			}
			this.lastPaintedClusterKey = paintKey;
			this.lastPaintedClusterRows = paintRows;
			let output = saveCursor();
			paintRows.forEach((line, index) => {
				output += moveCursor(startRow + index, 1) + clearLine() + line;
			});
			const painted = cursorPaint ? output + cursorPaint : output + restoreCursor();
			profileCount("fixed.cluster.paint.full");
			profileSample("fixed.cluster.paint.rows.count", cluster.lines.length);
			profileTextBytes("fixed.cluster.paint.bytes", painted);
			return painted;
		} finally {
			profileDuration("fixed.cluster.paint.ms", start);
		}
	}
}
