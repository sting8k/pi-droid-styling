import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

export interface FixedZoneSidebarTheme {
	fg(color: string, text: string): string;
}

export interface ModifiedFileEntry {
	path: string;
	insertions?: number;
	deletions?: number;
}

export interface FixedZoneSidebarInfo {
	sessionId?: string;
	sessionName?: string;
	cwd?: string;
	branch?: string;
	insertions?: number;
	deletions?: number;
	modifiedFiles?: ModifiedFileEntry[];
	piVersion?: string;
}

export type FixedZoneSidebarInfoProvider = () => FixedZoneSidebarInfo | null | undefined;

export interface FixedZoneSidebarLayout {
	active: boolean;
	rawWidth: number;
	contentWidth: number;
	sidebarWidth: number;
}

const MIN_RAW_WIDTH_FOR_SIDEBAR = 110;
const MIN_CONTENT_WIDTH_WITH_SIDEBAR = 75;
const MIN_SIDEBAR_WIDTH = 24;
const MEDIUM_SIDEBAR_WIDTH = 30;
const MAX_SIDEBAR_WIDTH = 36;
const BOX_VERTICAL = "│";
const CONTENT_PADDING = 1;
const MAX_FILE_DIFF_COLUMN_WIDTH = 11;
const MAX_MODIFIED_FILES = 10;
const FILE_BULLET_GAP = " ";
const CWD_ICON = "";
const BRANCH_ICON = "⎇";

function inactiveLayout(rawWidth: number): FixedZoneSidebarLayout {
	return { active: false, rawWidth, contentWidth: rawWidth, sidebarWidth: 0 };
}

function preferredSidebarWidth(rawWidth: number): number {
	if (rawWidth >= 140) return MAX_SIDEBAR_WIDTH;
	if (rawWidth >= 120) return MEDIUM_SIDEBAR_WIDTH;
	return MIN_SIDEBAR_WIDTH;
}

export function computeFixedZoneSidebarLayout(rawWidth: number, enabled: boolean): FixedZoneSidebarLayout {
	const safeRawWidth = Math.max(1, Math.floor(rawWidth));
	if (!enabled || safeRawWidth < MIN_RAW_WIDTH_FOR_SIDEBAR) return inactiveLayout(safeRawWidth);
	const width = Math.min(preferredSidebarWidth(safeRawWidth), safeRawWidth - MIN_CONTENT_WIDTH_WITH_SIDEBAR);
	if (width < MIN_SIDEBAR_WIDTH) return inactiveLayout(safeRawWidth);
	return {
		active: true,
		rawWidth: safeRawWidth,
		contentWidth: safeRawWidth - width,
		sidebarWidth: width,
	};
}

function sanitize(text: unknown): string {
	return String(text ?? "").replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function fit(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	return visibleWidth(text) > safeWidth ? truncateToWidth(text, safeWidth, "…") : text;
}

function pad(text: string, width: number): string {
	const fitted = fit(text, width);
	return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}

function takeWidth(text: string, width: number): { head: string; tail: string } {
	const safeWidth = Math.max(1, width);
	let used = 0;
	let end = 0;
	for (const char of Array.from(text)) {
		const charWidth = Math.max(0, visibleWidth(char));
		if (end > 0 && used + charWidth > safeWidth) break;
		if (end === 0 && charWidth > safeWidth) {
			end += char.length;
			break;
		}
		used += charWidth;
		end += char.length;
	}
	return { head: text.slice(0, end), tail: text.slice(end) };
}

function wrapText(text: string, width: number): string[] {
	const normalized = sanitize(text);
	if (!normalized) return ["—"];
	const lines: string[] = [];
	let remaining = normalized;
	while (remaining) {
		const { head, tail } = takeWidth(remaining, width);
		lines.push(head);
		remaining = tail;
	}
	return lines.length > 0 ? lines : ["—"];
}

function color(theme: FixedZoneSidebarTheme | undefined, colorName: string, text: string): string {
	return theme ? theme.fg(colorName, text) : text;
}

function borderChar(theme: FixedZoneSidebarTheme | undefined, char: string): string {
	return color(theme, "borderMuted", char);
}

function bullet(theme?: FixedZoneSidebarTheme): string {
	return color(theme, "bashMode", "•");
}

function bright(text: string, theme?: FixedZoneSidebarTheme): string {
	return color(theme, "text", text);
}

function icon(symbol: string, theme?: FixedZoneSidebarTheme): string {
	return color(theme, "bashMode", symbol);
}

function section(text: string, innerWidth: number, theme?: FixedZoneSidebarTheme): string {
	const title = color(theme, "accent", text);
	const titleWidth = visibleWidth(text);
	if (titleWidth >= innerWidth) return title;
	const gap = " ";
	const rule = color(theme, "borderMuted", "─".repeat(Math.max(0, innerWidth - titleWidth - visibleWidth(gap))));
	return `${title}${gap}${rule}`;
}

function displayCwd(cwd: string | undefined): string {
	const raw = sanitize(cwd);
	if (!raw) return "—";
	const home = homedir().replace(/\\/g, "/");
	const normalized = raw.replace(/\\/g, "/");
	return normalized.startsWith(home) ? `~${normalized.slice(home.length)}` : normalized;
}

function compactFilePath(path: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const normalized = sanitize(path).replace(/\\/g, "/");
	if (!normalized) return "—";
	if (visibleWidth(normalized) <= safeWidth) return normalized;

	const parts = normalized.split("/").filter(Boolean);
	const basename = parts.at(-1) ?? normalized;
	if (visibleWidth(basename) <= safeWidth) return basename;

	const parent = parts.length > 1 ? parts.at(-2) : undefined;
	const withParent = parent ? `${parent}/${basename}` : basename;
	if (visibleWidth(withParent) <= safeWidth) return withParent;

	return fit(basename, safeWidth);
}

interface FileDiffColumns {
	insertions: number;
	deletions: number;
	gap: number;
	width: number;
}

function metricWidth(text: string): number {
	return visibleWidth(sanitize(text));
}

function createFileDiffColumns(files: readonly ModifiedFileEntry[]): FileDiffColumns {
	let insertions = 0;
	let deletions = 0;
	for (const file of files) {
		if (file.insertions) insertions = Math.max(insertions, metricWidth(`+${file.insertions}`));
		if (file.deletions) deletions = Math.max(deletions, metricWidth(`-${file.deletions}`));
	}
	const gap = insertions > 0 && deletions > 0 ? 1 : 0;
	const width = Math.min(MAX_FILE_DIFF_COLUMN_WIDTH, insertions + gap + deletions);
	return { insertions, deletions, gap, width };
}

function metricColumn(text: string, width: number, colorName: string, theme?: FixedZoneSidebarTheme): string {
	if (width <= 0) return "";
	if (!text) return " ".repeat(width);
	return color(theme, colorName, padLeft(text, width));
}

function fileDiffText(file: ModifiedFileEntry, columns: FileDiffColumns, theme?: FixedZoneSidebarTheme): string {
	if (columns.width <= 0) return "";
	const insertionText = file.insertions ? `+${file.insertions}` : "";
	const deletionText = file.deletions ? `-${file.deletions}` : "";
	const rendered = [
		metricColumn(insertionText, columns.insertions, "success", theme),
		columns.gap > 0 ? " ".repeat(columns.gap) : "",
		metricColumn(deletionText, columns.deletions, "error", theme),
	].join("");
	return visibleWidth(rendered) > columns.width ? fit(rendered, columns.width) : rendered;
}

function dim(text: string, theme?: FixedZoneSidebarTheme): string {
	return color(theme, "dim", text);
}

function addLine(lines: string[], maxRows: number, value = ""): boolean {
	if (lines.length >= maxRows) return false;
	lines.push(value);
	return true;
}

function addLines(lines: string[], maxRows: number, values: string[]): boolean {
	for (const value of values) {
		if (!addLine(lines, maxRows, value)) return false;
	}
	return true;
}

function sectionGapRows(bodyRows: number): number {
	return bodyRows >= 18 ? 2 : 1;
}

function addSectionGap(lines: string[], maxRows: number, gapRows: number): void {
	for (let i = 0; i < gapRows; i++) addLine(lines, maxRows, "");
}

function contentLine(left: string, innerWidth: number): string {
	return pad(left, innerWidth);
}

function padLeft(text: string, width: number): string {
	const fitted = fit(text, width);
	return `${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}${fitted}`;
}

function wrappedValueLines(prefix: string, value: string, innerWidth: number, colorName: string, theme?: FixedZoneSidebarTheme): string[] {
	const prefixWidth = visibleWidth(prefix);
	const valueWidth = Math.max(1, innerWidth - prefixWidth);
	return wrapText(value, valueWidth).map((line, index) => {
		const rendered = color(theme, colorName, line);
		return index === 0 ? `${prefix}${rendered}` : `${" ".repeat(prefixWidth)}${rendered}`;
	});
}

function fileLine(file: ModifiedFileEntry, innerWidth: number, columns: FileDiffColumns, theme?: FixedZoneSidebarTheme): string {
	const diff = fileDiffText(file, columns, theme);
	const prefix = `${bullet(theme)}${FILE_BULLET_GAP}`;
	const prefixWidth = visibleWidth(prefix);
	const diffColumnWidth = visibleWidth(diff);
	const diffGap = diffColumnWidth > 0 ? 1 : 0;
	const pathWidth = Math.max(1, innerWidth - prefixWidth - diffColumnWidth - diffGap);
	const path = color(theme, "muted", compactFilePath(file.path, pathWidth));

	if (diffColumnWidth > 0) {
		return `${prefix}${path}${" ".repeat(Math.max(1, innerWidth - prefixWidth - visibleWidth(path) - diffColumnWidth))}${diff}`;
	}
	return contentLine(`${prefix}${path}`, innerWidth);
}

export function renderFixedZoneSidebar(info: FixedZoneSidebarInfo | null | undefined, width: number, rows: number, theme?: FixedZoneSidebarTheme): string[] {
	const safeRows = Math.max(0, Math.floor(rows));
	const safeWidth = Math.max(1, Math.floor(width));
	if (safeRows === 0) return [];

	const data = info ?? {};
	const innerWidth = Math.max(1, safeWidth - 2 - CONTENT_PADDING * 2);
	const bodyRows = Math.max(0, safeRows - 1);
	const body: string[] = [];
	const sectionGap = sectionGapRows(bodyRows);

	addLine(body, bodyRows, section("Session", innerWidth, theme));
	addLines(body, bodyRows, wrappedValueLines(`${bullet(theme)} `, sanitize(data.sessionId) || "—", innerWidth, "text", theme));
	addLines(body, bodyRows, wrappedValueLines(`${bullet(theme)} `, sanitize(data.sessionName) || "—", innerWidth, "text", theme));
	addSectionGap(body, bodyRows, sectionGap);
	addLine(body, bodyRows, section("Project", innerWidth, theme));
	addLines(body, bodyRows, wrappedValueLines(`${icon(CWD_ICON, theme)} `, displayCwd(data.cwd), innerWidth, "accent", theme));

	const branch = sanitize(data.branch) || "—";
	addLines(body, bodyRows, wrappedValueLines(`${icon(BRANCH_ICON, theme)} `, branch, innerWidth, "mdLinkUrl", theme));

	addSectionGap(body, bodyRows, sectionGap);
	addLine(body, bodyRows, section("Modified Files", innerWidth, theme));

	const allFiles = data.modifiedFiles ?? [];
	const files = allFiles.slice(0, MAX_MODIFIED_FILES);
	const diffColumns = createFileDiffColumns(files);
	let usedFiles = 0;

	for (let index = 0; index < files.length; index++) {
		const file = files[index];
		if (!file || !sanitize(file.path)) continue;
		const remainingRows = bodyRows - body.length;
		const reserveMoreRow = index < files.length - 1 || allFiles.length > files.length ? 1 : 0;
		if (remainingRows <= reserveMoreRow) break;
		body.push(fileLine(file, innerWidth, diffColumns, theme));
		usedFiles++;
	}

	const hiddenCount = allFiles.length - usedFiles;
	if (hiddenCount > 0) addLine(body, bodyRows, `${bullet(theme)} ${dim(`${hiddenCount} more`, theme)}`);
	if (allFiles.length === 0) addLine(body, bodyRows, dim("clean", theme));

	while (body.length < bodyRows) body.push("");

	const version = sanitize(data.piVersion);
	const footerLine = version
		? `${color(theme, "bashMode", "π")} ${bright(version, theme)}`
		: color(theme, "bashMode", "π");

	const sidePad = " ".repeat(CONTENT_PADDING);
	const borderV = borderChar(theme, BOX_VERTICAL);
	const wrap = (line: string) => `${borderV}${sidePad}${pad(line, innerWidth)}${sidePad}${borderV}`;

	return [
		...body.map(wrap),
		wrap(padLeft(footerLine, innerWidth)),
	];
}
