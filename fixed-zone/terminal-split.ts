import { matchesKey } from "@earendil-works/pi-tui";
import { profileCount, profileDuration, profileNow, profileSample, profileTextBytes } from "../performance/profiler.js";
import { isVirtualizedChatContainer } from "../performance/virtualize-chat.js";
import { MAX_FIXED_ROOT_LINES, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { getTuiContentCursorColumn, getTuiContentInnerWidth, padTuiContentLine } from "../tui-padding.js";
import { paintFrameBackgroundLine, paintFrameBackgroundSegment } from "../theme/frame-background.js";
import { resolveUserZoneStyle, type UserZoneStyle } from "../user-zone/designs.js";

import { type FixedZoneCluster, type FixedZoneClusterOptions, type HiddenRenderable, renderFixedUserZoneCluster } from "./cluster.js";
import { computeFixedZoneSidebarLayout, renderFixedZoneSidebar, type FixedZoneSidebarInfoProvider, type FixedZoneSidebarLayout, type FixedZoneSidebarTheme } from "./sidebar.js";
import { FixedZoneSelection, SELECTION_MULTI_CLICK_MS, stripAnsi, type SelectionActivity, type SelectionPoint, type SelectionRegion } from "./selection.js";
import { defaultFixedZoneNoticeTtlMs, fixedZoneNoticeKey, renderFixedZoneNoticeFooter, type FixedZoneNotice, type FixedZoneNoticeKind, type FixedZoneNoticeTheme } from "./notice.js";

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

export interface SelectionCopyContext {
	emitOsc52Clipboard(): boolean;
	showNotice(kind: FixedZoneNoticeKind, message: string, ttlMs?: number): void;
}

export interface TerminalSplitOptions {
	onCopySelection?: (text: string, context: SelectionCopyContext) => void;
	requestScrollRender?: () => void;
	theme?: FixedZoneNoticeTheme & { frameBgAnsi?: () => string };
	scrollFrameMs?: number;
	userZoneStyle?: UserZoneStyle;
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

type SidebarRowsCache = {
	rawRows: number;
	sidebarWidth: number;
	selectionKey: string;
	rows: string[];
	renderedRows: string[];
};

type ScrollbarGeometry = {
	col: number;
	trackRows: number;
	maxStart: number;
	thumbTop: number;
	thumbRows: number;
};

const MIN_SCROLLABLE_ROWS = 3;
const WHEEL_SCROLL_BASE_LINES = 1;
const WHEEL_SCROLL_MAX_LINES = 4;
const WHEEL_SCROLL_BURST_MS = 90;
const WHEEL_SCROLL_RESET_MS = 160;
const WHEEL_SCROLL_MAX_PENDING_LINES = WHEEL_SCROLL_MAX_LINES * 2;
const WHEEL_SCROLL_MEDIUM_STEP_PENDING_LINES = 3;
const WHEEL_SCROLL_MEDIUM_STEP_LINES = 2;
const WHEEL_SCROLL_LARGE_STEP_PENDING_LINES = 4;
const WHEEL_SCROLL_LARGE_STEP_LINES = 3;
const WHEEL_SCROLL_FAST_STEP_PENDING_LINES = 5;
const WHEEL_SCROLL_FAST_STEP_LINES = 4;
const DEFAULT_SCROLL_FRAME_MS = 20;
const SELECTION_CLEAR_AFTER_COPY_MS = 700;
const MAX_OSC52_ENCODED_LENGTH = 100_000;
const SCROLLBAR_DIM = "\x1b[2m";
const SCROLLBAR_RESET_INTENSITY = "\x1b[22m";
const SCROLLBAR_VISIBLE_MS = 2500;
const SCROLLBAR_HIT_COLUMNS = 3;
// Leave the physical last column blank; exact-width glyph writes can leave terminals in a pending-wrap state.
const SCROLLBAR_WRAP_GUARD_COLUMNS = 1;
const JUMP_BOTTOM_INPUT = "\x07";
const JUMP_TOP_INPUT = "\x14";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?1007l";
const DISABLE_MOUSE = "\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1007h";
const DISABLE_AUTOWRAP = "\x1b[?7l";
const ENABLE_AUTOWRAP = "\x1b[?7h";
const RESET_TERMINAL_SEGMENT = "\x1b[0m\x1b]8;;\x07";
const CLEAR_VIEWPORT = "\x1b[2J\x1b[H";

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

function applyContentInset(lines: readonly string[], width: number): string[] {
	return lines.map((line) => padTuiContentLine(line, width));
}

function applyContentInsetToCluster(cluster: FixedZoneCluster, width: number): FixedZoneCluster {
	const result: FixedZoneCluster = { lines: applyContentInset(cluster.lines, width) };
	if (cluster.cursor) {
		result.cursor = {
			...cluster.cursor,
			col: getTuiContentCursorColumn(cluster.cursor.col, width),
		};
	}
	return result;
}

function isBlankVisualLine(line: string): boolean {
	return stripAnsi(line).trim().length === 0;
}

function trimTrailingSpacerLine(cluster: FixedZoneCluster): FixedZoneCluster {
	const lastRow = cluster.lines.length;
	if (lastRow === 0 || cluster.cursor?.row === lastRow) return cluster;
	if (!isBlankVisualLine(cluster.lines[lastRow - 1] ?? "")) return cluster;
	return { lines: cluster.lines.slice(0, -1), cursor: cluster.cursor };
}

function limitClusterRows(cluster: FixedZoneCluster, maxRows: number): FixedZoneCluster {
	if (maxRows <= 0) return { lines: [] };
	if (cluster.lines.length <= maxRows) return cluster;
	const start = cluster.lines.length - maxRows;
	const cursor = cluster.cursor && cluster.cursor.row > start
		? { row: cluster.cursor.row - start, col: cluster.cursor.col }
		: undefined;
	return { lines: cluster.lines.slice(start), cursor };
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

function mouseScrollDirection(packet: SgrMousePacket): number {
	if (packet.final !== "M") return 0;
	const baseButton = mouseBaseButton(packet.button);
	if (baseButton === 64) return 1;
	if (baseButton === 65) return -1;
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
	private scrollbarDragging = false;
	private scrollbarDragOffset = 0;
	private scrollbarVisibleUntil = 0;
	private scrollbarHideTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly selection = new FixedZoneSelection();
	private selectionCopyTimer: ReturnType<typeof setTimeout> | undefined;
	private selectionClearTimer: ReturnType<typeof setTimeout> | undefined;
	private notice: FixedZoneNotice | null = null;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private pendingMouseInput = "";
	private lastWheelAt = 0;
	private lastWheelDirection = 0;
	private wheelBurst = 0;
	private smoothScrollPendingDelta = 0;
	private smoothScrollTimer: ReturnType<typeof setTimeout> | undefined;
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

	private fixedStyle(): UserZoneStyle["fixed"] {
		return (this.options.userZoneStyle ?? resolveUserZoneStyle(undefined)).fixed;
	}

	showNotice(kind: FixedZoneNoticeKind, message: string, ttlMs = defaultFixedZoneNoticeTtlMs(kind)): void {
		this.clearNoticeTimer();
		this.notice = { kind, message };
		profileCount(`fixed.notice.show.${kind}`);
		profileSample("fixed.notice.message.chars", message.length);
		this.clusterCache = undefined;
		this.resetClusterPaintCache();
		this.tui.requestRender();
		this.noticeTimer = setTimeout(() => {
			this.noticeTimer = undefined;
			if (this.disposed) return;
			this.clearNotice();
		}, Math.max(0, Math.floor(ttlMs)));
	}

	private clearNotice(): void {
		this.clearNoticeTimer();
		if (!this.notice) return;
		this.notice = null;
		this.clusterCache = undefined;
		this.resetClusterPaintCache();
		this.tui.requestRender();
	}

	private clearNoticeTimer(): void {
		if (!this.noticeTimer) return;
		clearTimeout(this.noticeTimer);
		this.noticeTimer = undefined;
	}

	install(): void {
		if (this.disposed) return;
		const terminal = this.tui.terminal;
		const rawRows = this.getRawRows();
		const layout = this.getSidebarLayout(this.getRawColumns());
		const cluster = this.refreshCluster(layout.contentWidth, rawRows);
		this.syncScrollRegion(this.getScrollBottom(rawRows, cluster.lines.length));
		this.clearViewport();
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
		this.lastWheelAt = 0;
		this.lastWheelDirection = 0;
		this.wheelBurst = 0;
		this.clearSmoothWheelScroll();
		this.clearPendingSelectionTimers();
		this.clearNoticeTimer();
		this.scrollbarDragging = false;
		this.scrollbarDragOffset = 0;
		this.scrollbarVisibleUntil = 0;
		if (this.scrollbarHideTimer) {
			clearTimeout(this.scrollbarHideTimer);
			this.scrollbarHideTimer = undefined;
		}
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
		this.writeRaw(setScrollRegion(1, Math.max(1, this.getRawRows())) + CLEAR_VIEWPORT);
		this.tui.requestRender(true);
	}

	private writeRaw(data: string): void {
		profileCount("terminal.write.raw.calls");
		profileTextBytes("terminal.write.raw.bytes", data);
		this.originalTerminalWrite.call(this.tui.terminal, data);
	}

	private writeGrid(data: string): void {
		if (data.length === 0) return;
		this.writeRaw(DISABLE_AUTOWRAP + data + ENABLE_AUTOWRAP);
	}

	private clearViewport(): void {
		this.writeRaw(CLEAR_VIEWPORT);
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
		if (!active && this.selection.anchor?.region === "sidebar") this.clearSelection();
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
		return this.selection.cacheKey("sidebar");
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

	private markClusterPaintDirty(data: string, clusterHeight = this.lastClusterHeight): void {
		// TUI diff rendering owns only the scrollable region, while the fixed cluster
		// is painted out-of-band. In practice, line clears, CR/LF, or terminal
		// pending-wrap state near the scroll/fixed boundary can still mutate the first
		// fixed row even when the cluster data itself is unchanged. Treat any core
		// write while the cluster exists as making the cluster paint cache unsafe.
		if (clusterHeight > 0 && data.length > 0) {
			profileCount("fixed.cluster.paint.dirty.coreWrite");
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

	private frameBgAnsi(): string {
		try {
			return this.options.theme?.frameBgAnsi?.() ?? "";
		} catch {
			return "";
		}
	}

	private paintFrameRow(line: string, targetWidth = this.getRawColumns()): string {
		return paintFrameBackgroundLine(line, this.frameBgAnsi(), targetWidth);
	}

	private paintFrameSegment(text: string): string {
		return paintFrameBackgroundSegment(text, this.frameBgAnsi());
	}

	private getMaxClusterRows(rawRows = this.getRawRows()): number {
		return Math.max(0, rawRows - MIN_SCROLLABLE_ROWS);
	}

	private renderNoticeFooter(width: number): string {
		return padTuiContentLine(renderFixedZoneNoticeFooter(this.notice, getTuiContentInnerWidth(width), this.options.theme), width);
	}

	private renderCluster(width = this.getSidebarLayout().contentWidth, rawRows = this.getRawRows()): FixedZoneCluster {
		const start = profileNow();
		this.renderingCluster = true;
		try {
			const maxClusterRows = this.getMaxClusterRows(rawRows);
			const footerRows = maxClusterRows > 0 ? 1 : 0;
			const contentRows = Math.max(0, maxClusterRows - footerRows);
			const renderContentRows = contentRows > 0 ? contentRows + footerRows : 0;
			const renderedCluster = renderContentRows > 0
				? renderFixedUserZoneCluster(this.hiddenRenderables, getTuiContentInnerWidth(width), renderContentRows, this.getClusterOptions())
				: { lines: [] };
			const cluster = footerRows > 0
				? limitClusterRows(trimTrailingSpacerLine(renderedCluster), contentRows)
				: renderedCluster;
			const insetCluster = applyContentInsetToCluster(cluster, width);
			if (footerRows > 0) insetCluster.lines.push(this.renderNoticeFooter(width));
			profileSample("fixed.cluster.rows.count", insetCluster.lines.length);
			profileSample("fixed.notice.footer.rows.count", footerRows);
			return insetCluster;
		} finally {
			this.renderingCluster = false;
			profileDuration("fixed.cluster.render.ms", start);
		}
	}

	private getClusterOptions(): FixedZoneClusterOptions {
		const style = this.fixedStyle();
		return {
			scrollHint: this.scrollOffset > 0 ? style.jumpBottomHint : style.jumpTopHint,
			hintRightInset: style.scrollHintRightInset,
			scrollHintPlacement: style.scrollHintPlacement,
		};
	}

	private getClusterStateKey(): string {
		return `${this.scrollOffset > 0 ? "scrolled" : "bottom"}:${fixedZoneNoticeKey(this.notice)}`;
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

	private markScrollbarInteraction(): void {
		this.scrollbarVisibleUntil = Date.now() + SCROLLBAR_VISIBLE_MS;
		if (this.scrollbarHideTimer) clearTimeout(this.scrollbarHideTimer);
		this.scrollbarHideTimer = setTimeout(() => {
			this.scrollbarHideTimer = undefined;
			this.scrollbarVisibleUntil = 0;
			if (!this.disposed && !this.scrollbarDragging && this.scrollOffset <= 0) this.tui.requestRender(true);
		}, SCROLLBAR_VISIBLE_MS);
	}

	private shouldShowScrollbar(): boolean {
		return this.scrollOffset > 0 || this.scrollbarDragging || Date.now() <= this.scrollbarVisibleUntil;
	}

	private isScrollbarActive(): boolean {
		return this.scrollbarDragging || Date.now() <= this.scrollbarVisibleUntil;
	}

	private formatScrollbarGlyph(color: string, glyph = this.fixedStyle().scrollbarGlyph): string {
		const theme = this.options.sidebar?.theme;
		try {
			if (theme && typeof theme.fg === "function") {
				return `${SCROLLBAR_RESET_INTENSITY}${theme.fg(color, glyph)}${SCROLLBAR_RESET_INTENSITY}`;
			}
		} catch {}
		return `${SCROLLBAR_RESET_INTENSITY}${SCROLLBAR_DIM}${glyph}${SCROLLBAR_RESET_INTENSITY}`;
	}

	private computeScrollbarGeometry(totalRows = this.lastRootLineCount, scrollableRows = this.visibleScrollableRows, start = this.visibleRootStart): ScrollbarGeometry | null {
		if (!this.fixedStyle().showScrollbar) return null;
		const layout = this.getSidebarLayout(this.getRawColumns());
		const trackRows = Math.max(0, scrollableRows);
		const scrollbarCol = Math.max(1, layout.contentWidth - SCROLLBAR_WRAP_GUARD_COLUMNS);
		if (totalRows <= trackRows || trackRows <= 1 || scrollbarCol <= 0) return null;

		const maxStart = Math.max(1, totalRows - trackRows);
		const thumbRows = Math.max(1, Math.min(trackRows, Math.round((trackRows / totalRows) * trackRows)));
		const thumbTop = Math.max(0, Math.min(trackRows - thumbRows, Math.round((start / maxStart) * (trackRows - thumbRows))));
		return { col: scrollbarCol, trackRows, maxStart, thumbTop, thumbRows };
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
			const rootRenderWidth = getTuiContentInnerWidth(layout.contentWidth);
			let lines: string[];
			let omittedLines = 0;
			let linesHaveContentInset = false;
			try {
				const windowed = this.renderWindowedRoot(rootRenderWidth, retainedLines);
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
					lines = windowed.omitted ? [this.rootOmittedMarker(windowed, rootRenderWidth), ...windowed.lines] : windowed.lines;
				} else {
					profileCount("fixed.root.windowRender.fallback.noChildren");
					const renderedLines = this.originalTuiRender(layout.contentWidth);
					profileDuration("fixed.root.originalRender.ms", rootRenderStart);
					profileSample("fixed.root.originalLines.count", renderedLines.length);
					omittedLines = Math.max(0, renderedLines.length - retainedLines);
					linesHaveContentInset = true;
					lines = omittedLines > 0
						? [
							padTuiContentLine(safeTruncateToWidth(`… ${omittedLines} earlier rendered lines omitted`, rootRenderWidth, "…"), layout.contentWidth),
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
				linesHaveContentInset = true;
				lines = omittedLines > 0
					? [
						padTuiContentLine(safeTruncateToWidth(`… ${omittedLines} earlier rendered lines omitted`, rootRenderWidth, "…"), layout.contentWidth),
						...renderedLines.slice(-retainedLines),
					]
					: renderedLines;
			}
			if (!linesHaveContentInset) lines = applyContentInset(lines, layout.contentWidth);
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

	private setScrollOffset(nextOffset: number, reason: string): boolean {
		const maxOffset = this.getMaxScrollOffset();
		const next = Math.max(0, Math.min(maxOffset, nextOffset));
		if (next === this.scrollOffset) {
			profileCount(`fixed.input.${reason}.noop`);
			return false;
		}

		this.clearSelection();
		this.markScrollbarInteraction();
		this.scrollOffset = next;
		if (this.options.requestScrollRender) this.options.requestScrollRender();
		else this.tui.requestRender();
		return true;
	}

	private getSmoothScrollFrameMs(): number {
		const frameMs = this.options.scrollFrameMs;
		if (typeof frameMs !== "number" || !Number.isFinite(frameMs) || frameMs < 0) return DEFAULT_SCROLL_FRAME_MS;
		return Math.floor(frameMs);
	}

	private clearSmoothWheelScrollTimer(): void {
		if (!this.smoothScrollTimer) return;
		clearTimeout(this.smoothScrollTimer);
		this.smoothScrollTimer = undefined;
	}

	private clearSmoothWheelScroll(): void {
		this.smoothScrollPendingDelta = 0;
		this.clearSmoothWheelScrollTimer();
	}

	private scheduleSmoothWheelScrollStep(): void {
		if (this.smoothScrollTimer || this.smoothScrollPendingDelta === 0) return;
		this.smoothScrollTimer = setTimeout(() => {
			this.smoothScrollTimer = undefined;
			this.consumeSmoothWheelScrollStep();
		}, this.getSmoothScrollFrameMs());
	}

	private getSmoothWheelStepMagnitude(pendingMagnitude: number): number {
		if (pendingMagnitude >= WHEEL_SCROLL_FAST_STEP_PENDING_LINES) {
			return Math.min(WHEEL_SCROLL_FAST_STEP_LINES, pendingMagnitude);
		}
		if (pendingMagnitude >= WHEEL_SCROLL_LARGE_STEP_PENDING_LINES) {
			return Math.min(WHEEL_SCROLL_LARGE_STEP_LINES, pendingMagnitude);
		}
		if (pendingMagnitude >= WHEEL_SCROLL_MEDIUM_STEP_PENDING_LINES) {
			return Math.min(WHEEL_SCROLL_MEDIUM_STEP_LINES, pendingMagnitude);
		}
		return 1;
	}

	private consumeSmoothWheelScrollStep(): void {
		if (this.disposed || this.smoothScrollPendingDelta === 0) {
			this.clearSmoothWheelScroll();
			return;
		}

		const pendingMagnitude = Math.abs(this.smoothScrollPendingDelta);
		const stepMagnitude = this.getSmoothWheelStepMagnitude(pendingMagnitude);
		const step = this.smoothScrollPendingDelta > 0 ? stepMagnitude : -stepMagnitude;
		this.smoothScrollPendingDelta -= step;
		const moved = this.setScrollOffset(this.scrollOffset + step, "smoothWheel");
		profileSample("fixed.input.smoothWheel.step", stepMagnitude);
		profileSample("fixed.input.smoothWheel.pending", Math.abs(this.smoothScrollPendingDelta));
		if (!moved) {
			this.clearSmoothWheelScroll();
			return;
		}
		this.scheduleSmoothWheelScrollStep();
	}

	private smoothWheelScrollBy(delta: number): void {
		profileCount("fixed.input.smoothWheel.calls");
		profileSample("fixed.input.smoothWheel.delta", delta);
		if (delta === 0) return;

		if (this.smoothScrollPendingDelta !== 0 && Math.sign(delta) !== Math.sign(this.smoothScrollPendingDelta)) {
			this.smoothScrollPendingDelta = 0;
		}

		const pending = this.smoothScrollPendingDelta + delta;
		this.smoothScrollPendingDelta = Math.max(-WHEEL_SCROLL_MAX_PENDING_LINES, Math.min(WHEEL_SCROLL_MAX_PENDING_LINES, pending));
		profileSample("fixed.input.smoothWheel.pending", Math.abs(this.smoothScrollPendingDelta));
		this.clearSmoothWheelScrollTimer();
		this.consumeSmoothWheelScrollStep();
	}

	private scrollBy(delta: number): void {
		this.clearSmoothWheelScroll();
		profileCount("fixed.input.scrollBy.calls");
		profileSample("fixed.input.scrollBy.delta", delta);
		this.setScrollOffset(this.scrollOffset + delta, "scrollBy");
	}

	private getAcceleratedWheelScrollDelta(direction: number, now = Date.now()): number {
		const elapsed = this.lastWheelAt > 0 ? now - this.lastWheelAt : Number.POSITIVE_INFINITY;
		const sameDirection = direction === this.lastWheelDirection;

		if (!sameDirection || elapsed > WHEEL_SCROLL_RESET_MS) {
			this.wheelBurst = 0;
		} else if (elapsed <= WHEEL_SCROLL_BURST_MS) {
			this.wheelBurst = Math.min(WHEEL_SCROLL_MAX_LINES - WHEEL_SCROLL_BASE_LINES, this.wheelBurst + 1);
		} else {
			this.wheelBurst = Math.max(0, this.wheelBurst - 1);
		}

		this.lastWheelAt = now;
		this.lastWheelDirection = direction;
		const lines = Math.min(WHEEL_SCROLL_MAX_LINES, WHEEL_SCROLL_BASE_LINES + this.wheelBurst);
		profileSample("fixed.input.mouseScroll.lines", lines);
		return direction * lines;
	}

	private jumpToTop(): void {
		profileCount("fixed.input.jumpTop.calls");
		this.clearSmoothWheelScroll();
		this.setScrollOffset(this.getMaxScrollOffset(), "jumpTop");
	}

	private jumpToBottom(): void {
		profileCount("fixed.input.jumpBottom.calls");
		this.clearSmoothWheelScroll();
		this.setScrollOffset(0, "jumpBottom");
	}

	private scrollbarGeometryForPacket(packet: SgrMousePacket): ScrollbarGeometry | null {
		const geometry = this.computeScrollbarGeometry();
		if (!geometry || packet.row < 1 || packet.row > geometry.trackRows) return null;
		const hitEndCol = Math.min(this.getSidebarLayout().contentWidth, geometry.col + SCROLLBAR_WRAP_GUARD_COLUMNS);
		const hitStartCol = Math.max(1, hitEndCol - SCROLLBAR_HIT_COLUMNS + 1);
		if (packet.col < hitStartCol || packet.col > hitEndCol) return null;

		const rowIndex = packet.row - 1;
		const hitsThumb = rowIndex >= geometry.thumbTop && rowIndex < geometry.thumbTop + geometry.thumbRows;
		if (!this.shouldShowScrollbar() && !hitsThumb) return null;
		return geometry;
	}

	private setScrollFromScrollbarRow(row: number, geometry: ScrollbarGeometry, dragOffset: number, reason: string): void {
		this.clearSmoothWheelScroll();
		const maxThumbTop = Math.max(0, geometry.trackRows - geometry.thumbRows);
		const thumbTop = Math.max(0, Math.min(maxThumbTop, row - 1 - dragOffset));
		const start = maxThumbTop <= 0 ? 0 : Math.round((thumbTop / maxThumbTop) * geometry.maxStart);
		profileSample(`fixed.scrollbar.${reason}.start`, start);
		this.setScrollOffset(this.getMaxScrollOffset() - start, `scrollbar.${reason}`);
	}

	private handleScrollbarPacket(packet: SgrMousePacket): boolean {
		if (this.scrollbarDragging) {
			if (isMouseRelease(packet)) {
				profileCount("fixed.scrollbar.drag.finish");
				this.scrollbarDragging = false;
				this.scrollbarDragOffset = 0;
				this.markScrollbarInteraction();
				return true;
			}

			if (isLeftDrag(packet)) {
				const geometry = this.computeScrollbarGeometry();
				if (!geometry) return true;
				profileCount("fixed.scrollbar.drag.move");
				this.setScrollFromScrollbarRow(packet.row, geometry, this.scrollbarDragOffset, "drag");
				return true;
			}
		}

		const geometry = this.scrollbarGeometryForPacket(packet);
		if (!geometry || !isLeftPress(packet)) return false;

		const rowIndex = packet.row - 1;
		if (rowIndex >= geometry.thumbTop && rowIndex < geometry.thumbTop + geometry.thumbRows) {
			profileCount("fixed.scrollbar.drag.start");
			this.clearSelection();
			this.tui.requestRender();
			this.scrollbarDragging = true;
			this.markScrollbarInteraction();
			this.scrollbarDragOffset = rowIndex - geometry.thumbTop;
			return true;
		}

		profileCount("fixed.scrollbar.track.click");
		this.scrollBy(rowIndex < geometry.thumbTop ? geometry.trackRows : -geometry.trackRows);
		return true;
	}

	private handleMousePacket(packet: SgrMousePacket): void {
		if (this.handleScrollbarPacket(packet)) return;
		const wheelDirection = mouseScrollDirection(packet);
		if (wheelDirection !== 0) {
			profileCount("fixed.input.mouseScroll.calls");
			this.smoothWheelScrollBy(this.getAcceleratedWheelScrollDelta(wheelDirection));
			return;
		}

		if (isMouseRelease(packet)) {
			this.finishSelection(this.selectionPointForPacket(packet));
			return;
		}

		const point = this.selectionPointForPacket(packet);
		if (!point) {
			if (isLeftPress(packet)) {
				this.selection.resetClickSequence();
				this.clearSelection();
			}
			return;
		}

		if (isLeftPress(packet)) {
			this.clearPendingSelectionTimers();
			this.startSelection(point);
			this.tui.requestRender();
			return;
		}

		if (isLeftDrag(packet)) {
			const dragResult = this.selection.updateDrag(point);
			if (dragResult === "noop") {
				profileCount("fixed.input.selection.dragNoop");
				return;
			}
			if (dragResult === "updated") {
				profileCount("fixed.input.selection.dragRender");
				this.tui.requestRender();
			}
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

	private startSelection(point: SelectionPoint): void {
		const clickCount = this.selection.registerPress(point);
		if (clickCount >= 3 && this.selection.selectLine(point, this.selectionSourceLines(point.region))) {
			profileCount("fixed.input.selection.line");
			return;
		}
		if (clickCount === 2 && this.selection.selectWord(point, this.selectionSourceLines(point.region))) {
			profileCount("fixed.input.selection.word");
			return;
		}
		profileCount("fixed.input.selection.start");
		this.selection.startDrag(point);
	}

	private selectionSourceLines(region: SelectionRegion): readonly string[] {
		return region === "sidebar" ? this.sidebarRows : this.rootLines;
	}

	private finishSelection(point: SelectionPoint | null): void {
		const finishedActivity = this.selection.finish(point);
		if (!finishedActivity) return;
		profileCount("fixed.input.selection.finish");
		const selectedText = this.getSelectedText();
		if (selectedText) {
			if (finishedActivity === "word") {
				this.scheduleSelectionCopy(selectedText, finishedActivity);
				return;
			}
			this.copySelectionText(selectedText, finishedActivity);
			this.scheduleSelectionClear();
			this.tui.requestRender();
			return;
		}
		profileCount("fixed.input.selection.empty");
		this.clearSelection();
		this.tui.requestRender();
	}

	private scheduleSelectionCopy(text: string, activity: SelectionActivity): void {
		this.clearPendingSelectionTimers();
		this.selectionCopyTimer = setTimeout(() => {
			this.selectionCopyTimer = undefined;
			this.copySelectionText(text, activity);
			this.scheduleSelectionClear();
		}, SELECTION_MULTI_CLICK_MS);
	}

	private scheduleSelectionClear(): void {
		this.clearPendingSelectionClear();
		this.selectionClearTimer = setTimeout(() => {
			this.selectionClearTimer = undefined;
			if (this.disposed) return;
			this.selection.clear();
			this.tui.requestRender();
		}, SELECTION_CLEAR_AFTER_COPY_MS);
	}

	private clearPendingSelectionTimers(): void {
		this.clearPendingSelectionCopy();
		this.clearPendingSelectionClear();
	}

	private clearPendingSelectionCopy(): void {
		if (!this.selectionCopyTimer) return;
		clearTimeout(this.selectionCopyTimer);
		this.selectionCopyTimer = undefined;
	}

	private clearPendingSelectionClear(): void {
		if (!this.selectionClearTimer) return;
		clearTimeout(this.selectionClearTimer);
		this.selectionClearTimer = undefined;
	}

	private copySelectionText(text: string, activity: SelectionActivity): void {
		profileCount("fixed.input.selection.copy");
		profileCount(`fixed.input.selection.copy.${activity}`);
		profileSample("fixed.input.selection.copy.chars", text.length);
		this.options.onCopySelection?.(text, {
			emitOsc52Clipboard: () => this.emitOsc52Clipboard(text),
			showNotice: (kind, message, ttlMs) => this.showNotice(kind, message, ttlMs),
		});
	}

	private emitOsc52Clipboard(text: string): boolean {
		if (this.disposed || text.length === 0) return false;
		const encoded = Buffer.from(text, "utf8").toString("base64");
		if (encoded.length > MAX_OSC52_ENCODED_LENGTH) {
			profileCount("fixed.input.selection.osc52.tooLarge");
			return false;
		}
		try {
			this.writeRaw(`\x1b]52;c;${encoded}\x07`);
			profileCount("fixed.input.selection.osc52.emit");
			return true;
		} catch {
			profileCount("fixed.input.selection.osc52.error");
			return false;
		}
	}

	private clearSelection(): void {
		this.clearPendingSelectionTimers();
		this.selection.clear();
	}

	private getSelectedText(): string {
		return this.selection.getSelectedText({ root: this.rootLines, sidebar: this.sidebarRows });
	}

	private renderSelectionHighlight(line: string, lineIndex: number): string {
		return this.selection.renderLineHighlight("root", line, lineIndex);
	}

	private renderSidebarSelectionHighlight(line: string, lineIndex: number): string {
		return this.selection.renderLineHighlight("sidebar", line, lineIndex);
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
			const scrollbarPaint = this.buildScrollbarPaint();
			if (cluster.lines.length === 0 && !layout.active && scrollbarPaint.length === 0) {
				profileCount("fixed.repaint.skip.empty");
				return;
			}
			this.painting = true;
			try {
				const output = this.buildSidebarPaint(rawRows, layout, sidebarRows) + this.buildFixedClusterPaint(cluster, rawRows, layout, sidebarRows) + scrollbarPaint;
				if (output.length === 0) {
					profileCount("fixed.repaint.skip.unchanged");
					return;
				}
				profileTextBytes("fixed.repaint.output.bytes", output);
				this.writeGrid(output);
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
				const clusterHeight = cluster.lines.length;
				this.markClusterPaintDirty(data, clusterHeight);
				if (clusterHeight === 0) {
					const sidebarRows = this.renderSidebarRows(layout, rawRows);
					this.syncScrollRegion(this.getScrollBottom(rawRows, clusterHeight));
					const output = data + this.buildSidebarPaint(rawRows, layout, sidebarRows) + this.buildScrollbarPaint();
					profileTextBytes("fixed.write.output.bytes", output);
					this.writeGrid(output);
					return;
				}
				const scrollBottom = this.getScrollBottom(rawRows, clusterHeight);
				this.syncScrollRegion(scrollBottom);
				if (this.renderPassActive) {
					profileCount("fixed.write.core.renderPassOnly");
					this.moveToTuiCursor(scrollBottom);
					this.writeGrid(data);
					return;
				}
				const sidebarRows = this.renderSidebarRows(layout, rawRows);
				const output = data + this.buildSidebarPaint(rawRows, layout, sidebarRows) + this.buildFixedClusterPaint(cluster, rawRows, layout, sidebarRows) + this.buildScrollbarPaint();
				profileTextBytes("fixed.write.output.bytes", output);
				this.writeGrid(output);
			} finally {
				this.painting = false;
				if (!this.renderPassActive) this.sidebarRowsCache = undefined;
			}
		} finally {
			profileDuration("fixed.write.core.ms", totalStart);
		}
	}

	private buildScrollbarPaint(): string {
		const geometry = this.computeScrollbarGeometry();
		if (!geometry || !this.shouldShowScrollbar()) return "";

		const style = this.fixedStyle();
		const trackGlyph = this.formatScrollbarGlyph(style.scrollbarTrackColor, style.scrollbarGlyph);
		const thumbGlyph = this.formatScrollbarGlyph(this.isScrollbarActive() ? style.scrollbarThumbActiveColor : style.scrollbarThumbColor, style.scrollbarGlyph);
		let output = saveCursor();
		for (let index = 0; index < geometry.trackRows; index++) {
			const isThumb = index >= geometry.thumbTop && index < geometry.thumbTop + geometry.thumbRows;
			output += moveCursor(index + 1, geometry.col) + RESET_TERMINAL_SEGMENT + this.paintFrameSegment(isThumb ? thumbGlyph : trackGlyph);
		}
		const painted = output + restoreCursor();
		profileCount("fixed.scrollbar.paint");
		profileSample("fixed.scrollbar.paint.rows.count", geometry.trackRows);
		profileSample("fixed.scrollbar.thumbRows.count", geometry.thumbRows);
		profileSample("fixed.scrollbar.thumbTop", geometry.thumbTop);
		profileTextBytes("fixed.scrollbar.paint.bytes", painted);
		return painted;
	}

	private buildSidebarPaint(rawRows: number, layout: FixedZoneSidebarLayout, sidebarRows = this.renderSidebarRows(layout, rawRows)): string {
		const start = profileNow();
		try {
			if (!layout.active) {
				this.resetSidebarPaintCache();
				return "";
			}
			const blankSidebarRow = " ".repeat(layout.sidebarWidth);
			const paintRows = Array.from({ length: rawRows }, (_value, index) => this.paintFrameRow(sidebarRows[index] ?? blankSidebarRow, layout.sidebarWidth));
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
			const paintRows = cluster.lines.map((line, index) => this.paintFrameRow(this.composeWithSidebar(line, layout, sidebarRows, startRow + index - 1), this.getRawColumns()));
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
			const rowClear = this.frameBgAnsi() + clearLine();
			paintRows.forEach((line, index) => {
				const prefix = line.startsWith(rowClear) ? "" : rowClear;
				output += moveCursor(startRow + index, 1) + RESET_TERMINAL_SEGMENT + prefix + line;
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
