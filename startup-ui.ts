import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Spacer, Text } from "@earendil-works/pi-tui";
import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";
import { fgHex, parseFgAnsiToRgb, rgbToHex } from "./theme/ansi.js";

const PATCHED = Symbol.for("pi-droid-styling.startup-ui.patched");
const ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-droid-styling.startup-ui.original-show-loaded-resources");
const TRUE_ORIGINAL = Symbol.for("pi-droid-styling.startup-ui.true-original");
const CONSOLE_LOG_PATCHED = Symbol.for("pi-droid-styling.startup-ui.console-log-patched");
const SYSTEM_CONTEXT_PANEL_MIN_WIDTH = 64;
const TOOLS_PANEL_MIN_WIDTH = 64;
const CORE_TOOL_SOURCE_LABEL = "core";
const MESSAGE_TEXT_INDENT = "   ";
const STARTUP_PANEL_SIDE_PADDING = 2;
const SYSTEM_CONTEXT_TYPE_WIDTH = safeVisibleWidth("System & Context");
const SYSTEM_CONTEXT_METRIC_WIDTH = safeVisibleWidth("Words/Lines");
const RESOURCE_ROW_GAP = "  ·  ";
const PI_CLAUDE_LOGO = [
	"█████████",
	"███   ███",
	"██████   ███",
	"███      ███",
] as const;

type StartupInfo = {
	model: string;
	cwd: string;
};

/** Resolve the installed pi-coding-agent CHANGELOG.md (ships with each Pi version). */
function resolvePiChangelogPath(): string | undefined {
	try {
		const resolved = import.meta.resolve("@earendil-works/pi-coding-agent");
		let dir = dirname(fileURLToPath(resolved));
		while (true) {
			if (existsSync(join(dir, "package.json"))) {
				const changelog = join(dir, "CHANGELOG.md");
				return existsSync(changelog) ? changelog : undefined;
			}
			const parent = dirname(dir);
			if (parent === dir) return undefined;
			dir = parent;
		}
	} catch {
		return undefined;
	}
}

function stripChangelogInlineMd(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/** Prefer bold feature titles; otherwise first clause before an em/en dash. */
function changelogBulletTitle(line: string): string {
	const bold = line.match(/\*\*([^*]+)\*\*/);
	if (bold?.[1]) return stripChangelogInlineMd(bold[1]);
	const cleaned = stripChangelogInlineMd(line.replace(/^\s*-\s*/, ""));
	const clause = cleaned.split(/\s+[—–-]\s+/)[0]?.trim();
	return clause || cleaned;
}

function extractSectionBullets(section: string, max: number): string[] {
	const bullets: string[] = [];
	for (const heading of ["New Features", "Added"]) {
		const match = section.match(new RegExp(`### ${heading}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`));
		if (!match?.[1]) continue;
		for (const line of match[1].split("\n")) {
			if (!/^\s*-\s+/.test(line)) continue;
			const title = changelogBulletTitle(line);
			if (!title) continue;
			bullets.push(title);
			if (bullets.length >= max) return bullets;
		}
		if (bullets.length > 0) break;
	}
	return bullets;
}

function loadWhatsNewBullets(version: string, max = 2): string[] {
	const changelogPath = resolvePiChangelogPath();
	if (!changelogPath) return [];
	try {
		const md = readFileSync(changelogPath, "utf8");
		const escaped = version.replace(/\./g, "\\.");
		const headerRe = new RegExp(`^## \\[?${escaped}\\]?\\b.*$`, "m");
		const header = headerRe.exec(md);
		let section = "";
		if (header?.index !== undefined) {
			const start = header.index + header[0].length;
			const rest = md.slice(start);
			const next = rest.search(/^## /m);
			section = next >= 0 ? rest.slice(0, next) : rest;
		} else {
			// Fallback: latest released section (skip Unreleased).
			const released = /^## \[?\d+\.\d+\.\d+\]?.*$/m.exec(md);
			if (!released || released.index === undefined) return [];
			const start = released.index + released[0].length;
			const rest = md.slice(start);
			const next = rest.search(/^## /m);
			section = next >= 0 ? rest.slice(0, next) : rest;
		}
		return extractSectionBullets(section, max);
	} catch {
		return [];
	}
}

let cachedWhatsNew: { version: string; bullets: string[] } | undefined;

function getWhatsNewBullets(): string[] {
	if (cachedWhatsNew?.version === VERSION) return cachedWhatsNew.bullets;
	const bullets = loadWhatsNewBullets(VERSION, 2);
	cachedWhatsNew = { version: VERSION, bullets };
	return bullets;
}

function formatModelLabel(
	model: { provider?: string; id?: string } | null | undefined,
	scopedModels: any[] = [],
): string {
	if (model?.id) return model.provider ? `${model.provider}/${model.id}` : model.id;
	const scoped = scopedModels[0]?.model;
	if (scoped?.id) return scoped.provider ? `${scoped.provider}/${scoped.id}` : scoped.id;
	return "Default model";
}

function formatCwd(cwd: string): string {
	const home = homedir();
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

let startupInfo: StartupInfo = {
	model: "Loading…",
	cwd: "~",
};

let activeTheme: ThemeLike | undefined;
const FALLBACK_THEME: ThemeLike = {
	bold: (text) => text,
	fg: (_color, text) => text,
};

type ThemeLike = {
	bold(text: string): string;
	fg(color: string, text: string): string;
	getFgAnsi?(color: string): string;
	getColorMode?(): string;
};

type Rgb = { r: number; g: number; b: number };

const FALLBACK_ACCENT_RGB: Rgb = { r: 80, g: 160, b: 255 };
const LOGO_PALETTE_STEPS = 24;
const LOGO_MAX_DARKEN = 0.18;
const LOGO_MAX_LIGHTEN = 0.18;
const LOGO_ROW_PHASE_STEP = 0.12;

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function interpolateRgb(start: Rgb, end: Rgb, factor: number): Rgb {
	return {
		r: clampChannel(start.r + (end.r - start.r) * factor),
		g: clampChannel(start.g + (end.g - start.g) * factor),
		b: clampChannel(start.b + (end.b - start.b) * factor),
	};
}

function darkenRgb(rgb: Rgb, amount: number): Rgb {
	return {
		r: clampChannel(rgb.r * (1 - amount)),
		g: clampChannel(rgb.g * (1 - amount)),
		b: clampChannel(rgb.b * (1 - amount)),
	};
}

function lightenRgb(rgb: Rgb, amount: number): Rgb {
	return {
		r: clampChannel(rgb.r + (255 - rgb.r) * amount),
		g: clampChannel(rgb.g + (255 - rgb.g) * amount),
		b: clampChannel(rgb.b + (255 - rgb.b) * amount),
	};
}

function buildLogoPalette(accent: Rgb): Rgb[] {
	return Array.from({ length: LOGO_PALETTE_STEPS }, (_, index) => {
		const progress = index / LOGO_PALETTE_STEPS;
		const wave = -Math.cos(progress * Math.PI * 2);
		return wave < 0 ? darkenRgb(accent, LOGO_MAX_DARKEN * -wave) : lightenRgb(accent, LOGO_MAX_LIGHTEN * wave);
	});
}

function sampleLogoGradient(palette: Rgb[], position: number): Rgb {
	const wrapped = ((position % 1) + 1) % 1;
	const scaled = wrapped * palette.length;
	const baseIndex = Math.floor(scaled) % palette.length;
	const nextIndex = (baseIndex + 1) % palette.length;
	return interpolateRgb(palette[baseIndex]!, palette[nextIndex]!, scaled - Math.floor(scaled));
}

function renderLogoGradientLine(theme: ThemeLike, line: string, palette: Rgb[], phase: number): string {
	const characters = [...line];
	const span = Math.max(characters.length - 1, 1);
	return characters
		.map((character, index) => {
			if (character === " ") return character;
			const color = sampleLogoGradient(palette, index / span + phase);
			return fgHex(theme, rgbToHex(color), character);
		})
		.join("");
}

let logoGradientCacheKey: string | undefined;
let logoGradientCacheLines: string[] | undefined;

function styledLogoLines(theme: ThemeLike): string[] {
	const accentAnsi = theme.getFgAnsi?.("accent") ?? "";
	const mode = theme.getColorMode?.() ?? "truecolor";
	const cacheKey = `${mode}|${accentAnsi}`;
	if (cacheKey === logoGradientCacheKey && logoGradientCacheLines) return logoGradientCacheLines;
	const accent = parseFgAnsiToRgb(accentAnsi) ?? FALLBACK_ACCENT_RGB;
	const palette = buildLogoPalette(accent);
	logoGradientCacheLines = PI_CLAUDE_LOGO.map((line, rowIndex) =>
		renderLogoGradientLine(theme, line, palette, rowIndex * LOGO_ROW_PHASE_STEP),
	);
	logoGradientCacheKey = cacheKey;
	return logoGradientCacheLines;
}

type ResourceRow = {
	label: string;
	items: string[];
};

type SystemContextItem = {
	priority: number;
	kind: string;
	path: string;
	words: number;
	lines: number;
};

type AvailableTool = {
	source: string;
	name: string;
};

type ToolGroup = {
	source: string;
	tools: string[];
};

class ExpandableText extends Text {
	constructor(
		private readonly getCollapsedText: () => string,
		private readonly getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}

function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function isQuietStartup(cwd: string): boolean {
	const globalSettings = readJson(join(homedir(), ".pi", "agent", "settings.json"));
	const projectSettings = readJson(join(cwd, ".pi", "settings.json"));
	return Boolean((projectSettings.quietStartup ?? globalSettings.quietStartup) ?? false);
}

function discoverPromptFile(cwd: string, agentDir: string, filename: string): string | undefined {
	const projectPath = join(cwd, ".pi", filename);
	if (existsSync(projectPath)) return projectPath;

	const globalPath = join(agentDir, filename);
	if (existsSync(globalPath)) return globalPath;

	return undefined;
}

function countWords(text: string): number {
	return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	const lines = text.split(/\r\n|\r|\n/).length;
	return /\r\n$|\r$|\n$/.test(text) ? lines - 1 : lines;
}

function indentStartupLines(lines: string[]): string[] {
	return lines.map((line) => `${MESSAGE_TEXT_INDENT}${line}`);
}

function normalizeToolNames(names: unknown): string[] {
	return Array.isArray(names) ? names.filter((name) => typeof name === "string" && name.length > 0) : [];
}

function stripKnownExtension(name: string): string {
	return name.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i, "");
}

function compactSourcePathLabel(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) return "";
	const synthetic = /^<([^:>]+)(?::[^>]*)?>$/.exec(trimmed);
	if (synthetic?.[1]) return synthetic[1];
	const segments = trimmed.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "~");
	const last = segments.at(-1) ?? trimmed;
	if (/^index\.(?:mjs|cjs|js|jsx|ts|tsx)$/i.test(last) && segments.length > 1) return segments[segments.length - 2]!;
	return stripKnownExtension(last);
}

function compactPackageSourceLabel(source: string): string {
	if (source.startsWith("npm:")) return source.slice("npm:".length) || source;
	if (source.startsWith("git:")) return compactSourcePathLabel(source.replace(/\.git(?:#.*)?$/i, "")) || source;
	return source;
}

function toolSourceLabel(toolInfo: any): string {
	const sourceInfo = toolInfo?.sourceInfo;
	if (!sourceInfo || typeof sourceInfo !== "object") return CORE_TOOL_SOURCE_LABEL;
	const source = typeof sourceInfo.source === "string" ? sourceInfo.source : "";
	if (source === "builtin") return CORE_TOOL_SOURCE_LABEL;
	if (source === "sdk") return "sdk";
	if (source.startsWith("npm:") || source.startsWith("git:")) return compactPackageSourceLabel(source);
	const baseDir = typeof sourceInfo.baseDir === "string" ? sourceInfo.baseDir : "";
	if (baseDir) return compactSourcePathLabel(baseDir) || source || "extension";
	const path = typeof sourceInfo.path === "string" ? sourceInfo.path : "";
	if (path) return compactSourcePathLabel(path) || source || "extension";
	return source || "extension";
}

function getAvailableTools(session: any): AvailableTool[] {
	const hasActiveTools = typeof session?.getActiveToolNames === "function";
	const activeNames = normalizeToolNames(hasActiveTools ? session.getActiveToolNames() : undefined);
	const configuredTools = typeof session?.getAllTools === "function" ? session.getAllTools() : [];
	const allTools = Array.isArray(configuredTools) ? configuredTools : [];
	if (allTools.length > 0) {
		const activeSet = new Set(activeNames);
		return allTools
			.filter((tool: any) => typeof tool?.name === "string" && (!hasActiveTools || activeSet.has(tool.name)))
			.map((tool: any) => ({ source: toolSourceLabel(tool), name: tool.name }));
	}
	return activeNames.map((name) => ({ source: CORE_TOOL_SOURCE_LABEL, name }));
}

function groupAvailableTools(tools: AvailableTool[]): ToolGroup[] {
	const groups = new Map<string, Set<string>>();
	for (const tool of tools) {
		const source = tool.source.trim() || "extension";
		const name = tool.name.trim();
		if (!name) continue;
		const names = groups.get(source) ?? new Set<string>();
		names.add(name);
		groups.set(source, names);
	}

	return [...groups.entries()]
		.map(([source, names]) => ({ source, tools: [...names].sort((a, b) => a.localeCompare(b)) }))
		.sort((a, b) => {
			if (a.source === CORE_TOOL_SOURCE_LABEL) return -1;
			if (b.source === CORE_TOOL_SOURCE_LABEL) return 1;
			return a.source.localeCompare(b.source);
		});
}

function renderPanelBorder(theme: ThemeLike, left: string, right: string, panelWidth: number): string {
	return theme.fg("dim", `${left}${"─".repeat(panelWidth + STARTUP_PANEL_SIDE_PADDING * 2)}${right}`);
}

function renderPanelLine(theme: ThemeLike, content: string, panelWidth: number): string {
	const sidePadding = " ".repeat(STARTUP_PANEL_SIDE_PADDING);
	const padding = " ".repeat(Math.max(0, panelWidth - safeVisibleWidth(content)));
	return `${theme.fg("dim", "│")}${sidePadding}${content}${padding}${sidePadding}${theme.fg("dim", "│")}`;
}

function renderToolsPanel(theme: ThemeLike, tools: AvailableTool[], minTotalWidth = 0): string[] {
	const groups = groupAvailableTools(tools);
	if (groups.length === 0) return [];

	const titleLine = theme.bold(theme.fg("accent", "Available Tools"));
	const outerWidth = STARTUP_PANEL_SIDE_PADDING * 2 + 2;
	const sourceHeader = "Source";
	const countHeader = "Count";
	const toolsHeader = "Tools";
	const countWidth = Math.max(countHeader.length, ...groups.map((group) => String(group.tools.length).length));
	const columnDivider = ` ${theme.fg("muted", "|")} `;
	const columnDividerWidth = safeVisibleWidth(columnDivider);
	const panelWidth = Math.max(TOOLS_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine));
	const availableTextWidth = Math.max(sourceHeader.length + toolsHeader.length, panelWidth - countWidth - columnDividerWidth * 2);
	const maxSourceWidth = Math.max(sourceHeader.length, ...groups.map((group) => safeVisibleWidth(group.source)));
	const sourceWidth = Math.min(maxSourceWidth, Math.max(sourceHeader.length, Math.floor(availableTextWidth * 0.28)));
	const toolsWidth = Math.max(toolsHeader.length, availableTextWidth - sourceWidth);

	const header = `${theme.fg("text", sourceHeader.padEnd(sourceWidth))}${columnDivider}${theme.fg("text", countHeader.padStart(countWidth))}${columnDivider}${theme.fg("text", toolsHeader.padEnd(toolsWidth))}`;
	const separator = `${theme.fg("dim", "─".repeat(sourceWidth))}${columnDivider}${theme.fg("dim", "─".repeat(countWidth))}${columnDivider}${theme.fg("dim", "─".repeat(toolsWidth))}`;
	const lines = [
		renderPanelBorder(theme, "┌", "┐", panelWidth),
		renderPanelLine(theme, titleLine, panelWidth),
		renderPanelLine(theme, header, panelWidth),
		renderPanelLine(theme, separator, panelWidth),
	];

	for (const group of groups) {
		const count = String(group.tools.length);
		const toolList = safeTruncateToWidth(group.tools.join(", "), toolsWidth, "...", true);
		const source = safeTruncateToWidth(group.source, sourceWidth, "...", true);
		const countPadding = " ".repeat(Math.max(0, countWidth - count.length));
		lines.push(renderPanelLine(
			theme,
			`${theme.fg("text", source)}${columnDivider}${countPadding}${theme.bold(theme.fg("success", count))}${columnDivider}${theme.fg("text", toolList)}`,
			panelWidth,
		));
	}

	lines.push(renderPanelBorder(theme, "└", "┘", panelWidth));
	return lines;
}

function renderSystemContextPanel(theme: ThemeLike, items: SystemContextItem[], minTotalWidth = 0): string[] {
	const sortedItems = [...items].sort((a, b) => a.priority - b.priority);
	const titleLabel = "System & Context";
	const titleLine = theme.bold(theme.fg("accent", titleLabel));
	const outerWidth = STARTUP_PANEL_SIDE_PADDING * 2 + 2;

	if (sortedItems.length === 0) {
		const message = theme.fg("text", "No system or context files loaded");
		const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine), safeVisibleWidth(message));
		return [
			renderPanelBorder(theme, "┌", "┐", panelWidth),
			renderPanelLine(theme, titleLine, panelWidth),
			renderPanelLine(theme, message, panelWidth),
			renderPanelBorder(theme, "└", "┘", panelWidth),
		];
	}

	const typeHeader = "Type";
	const pathHeader = "Path";
	const metricLabel = "Words/Lines";
	const typeWidth = Math.max(SYSTEM_CONTEXT_TYPE_WIDTH, typeHeader.length, ...sortedItems.map((item) => safeVisibleWidth(item.kind)));
	const columnDivider = ` ${theme.fg("muted", "|")} `;
	const columnDividerWidth = safeVisibleWidth(columnDivider);
	const metricWidth = Math.max(SYSTEM_CONTEXT_METRIC_WIDTH, metricLabel.length, ...sortedItems.map((item) => `${item.words}/${item.lines}`.length));
	const fixedColumnsWidth = typeWidth + columnDividerWidth + columnDividerWidth + metricWidth;
	const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine));
	const pathWidth = Math.max(pathHeader.length, panelWidth - fixedColumnsWidth);
	const header = `${theme.fg("text", typeHeader.padEnd(typeWidth))}${columnDivider}${theme.fg("text", pathHeader.padEnd(pathWidth))}${columnDivider}${theme.fg("text", metricLabel.padStart(metricWidth))}`;
	const separator = `${theme.fg("dim", "─".repeat(typeWidth))}${columnDivider}${theme.fg("dim", "─".repeat(pathWidth))}${columnDivider}${theme.fg("dim", "─".repeat(metricWidth))}`;
	const lines = [
		renderPanelBorder(theme, "┌", "┐", panelWidth),
		renderPanelLine(theme, titleLine, panelWidth),
		renderPanelLine(theme, header, panelWidth),
		renderPanelLine(theme, separator, panelWidth),
	];

	for (const item of sortedItems) {
		const metric = `${item.words}/${item.lines}`;
		const typePadding = " ".repeat(Math.max(0, typeWidth - safeVisibleWidth(item.kind)));
		const path = safeTruncateToWidth(item.path, pathWidth, "...", true);
		const metricPadding = " ".repeat(Math.max(0, metricWidth - safeVisibleWidth(metric)));
		lines.push(renderPanelLine(
			theme,
			`${theme.fg("text", item.kind)}${typePadding}${columnDivider}${theme.fg("text", path)}${columnDivider}${metricPadding}${theme.fg("text", metric)}`,
			panelWidth,
		));
	}

	lines.push(renderPanelBorder(theme, "└", "┘", panelWidth));
	return lines;
}

function renderResourceChip(theme: ThemeLike, row: ResourceRow, highlighted: boolean): string {
	const label = theme.fg(highlighted ? "text" : "muted", row.label);
	const count = theme.bold(theme.fg("success", String(row.items.length)));
	const content = `${label} ${count}`;
	return content;
}

function renderResourceTable(theme: ThemeLike, rows: ResourceRow[], systemContextItems: SystemContextItem[], tools: AvailableTool[], expanded: boolean): string {
	const primaryLabel = systemContextItems.some((item) => item.kind === "system") ? "system" : rows[0]?.label;
	const total = rows
		.map((row) => renderResourceChip(theme, row, row.label === primaryLabel))
		.join(theme.fg("dim", RESOURCE_ROW_GAP));
	const summary = theme.bold(theme.fg("accent", "◆")) + MESSAGE_TEXT_INDENT.slice(1) + theme.bold(theme.fg("accent", "Resources")) + theme.fg("dim", total ? RESOURCE_ROW_GAP : "") + total;
	if (!expanded) return summary;

	const panelBodyWidth = Math.max(1, safeVisibleWidth(summary) - safeVisibleWidth(MESSAGE_TEXT_INDENT));
	const toolPanel = renderToolsPanel(theme, tools, panelBodyWidth);
	return [
		summary,
		"",
		...indentStartupLines(renderSystemContextPanel(theme, systemContextItems, panelBodyWidth)),
		...(toolPanel.length > 0 ? ["", ...indentStartupLines(toolPanel)] : []),
	].join("\n");
}

/** Claude Code welcome: slightly roomier mascot column + tips/news sidebar. */
const WELCOME_MIN_LEFT_WIDTH = 34;
const WELCOME_MAX_LEFT_WIDTH = 46;
const WELCOME_MIN_RIGHT_WIDTH = 28;
const WELCOME_COLUMN_GAP = 3; // ` │ `

function padRight(text: string, width: number, ellipsis = ""): string {
	const clipped = safeTruncateToWidth(text, width, ellipsis);
	return clipped + " ".repeat(Math.max(0, width - safeVisibleWidth(clipped)));
}

function borderLine(left: string, label: string, right: string, width: number, paint: (s: string) => string): string {
	if (width <= 1) return "";
	if (width < 8 || safeVisibleWidth(label) === 0) {
		return paint(left + "─".repeat(Math.max(0, width - 2)) + right);
	}
	const before = "─── ";
	const after = " ─────";
	const fixedWidth = safeVisibleWidth(before) + safeVisibleWidth(label) + safeVisibleWidth(after);
	const fill = Math.max(0, width - 2 - fixedWidth);
	return `${paint(left)}${paint(before)}${label}${paint(after)}${paint("─".repeat(fill))}${paint(right)}`;
}

function boxedLine(content: string, width: number, paint: (s: string) => string): string {
	if (width <= 2) return safeTruncateToWidth(content, width, "");
	return `${paint("│")}${padRight(content, width - 2)}${paint("│")}`;
}

/** Center text and pad both sides so the cluster is truly mid-column (not left-biased). */
function centerText(text: string, width: number): string {
	if (width <= 0) return "";
	const w = safeVisibleWidth(text);
	if (w >= width) return safeTruncateToWidth(text, width, "…");
	const leftPad = Math.floor((width - w) / 2);
	const rightPad = width - w - leftPad;
	return `${" ".repeat(leftPad)}${text}${" ".repeat(rightPad)}`;
}

function welcomeColumnWidths(innerWidth: number): { leftWidth: number; rightWidth: number; useRight: boolean } {
	if (innerWidth <= 0) return { leftWidth: 0, rightWidth: 0, useRight: false };
	if (innerWidth < WELCOME_MIN_LEFT_WIDTH + WELCOME_COLUMN_GAP + WELCOME_MIN_RIGHT_WIDTH) {
		return { leftWidth: innerWidth, rightWidth: 0, useRight: false };
	}

	// Slightly roomier mascot column (~38%) so long model labels fit without crowding tips.
	let leftWidth = Math.min(
		WELCOME_MAX_LEFT_WIDTH,
		Math.max(WELCOME_MIN_LEFT_WIDTH, Math.round(innerWidth * 0.38)),
	);
	let rightWidth = innerWidth - WELCOME_COLUMN_GAP - leftWidth;
	if (rightWidth < WELCOME_MIN_RIGHT_WIDTH) {
		rightWidth = WELCOME_MIN_RIGHT_WIDTH;
		leftWidth = innerWidth - WELCOME_COLUMN_GAP - rightWidth;
	}
	if (leftWidth < WELCOME_MIN_LEFT_WIDTH || rightWidth < WELCOME_MIN_RIGHT_WIDTH) {
		return { leftWidth: innerWidth, rightWidth: 0, useRight: false };
	}
	return { leftWidth, rightWidth, useRight: true };
}

function twoColumn(
	left: string,
	right: string,
	leftWidth: number,
	rightWidth: number,
	paint: (s: string) => string,
): string {
	return `${padRight(left, leftWidth)} ${paint("│")} ${padRight(right, rightWidth, "…")}`;
}

/** Render the compact PR logo with a theme-derived gradient. */
function piLogoLines(theme: ThemeLike): string[] {
	return styledLogoLines(theme);
}

/** Prefer keeping the model id (after `/`) when the full provider/id label is too wide. */
function truncateModelLabel(model: string, width: number): string {
	if (width <= 0) return "";
	if (safeVisibleWidth(model) <= width) return model;
	const slash = model.lastIndexOf("/");
	if (slash > 0) {
		const id = model.slice(slash + 1);
		if (safeVisibleWidth(id) <= width) return id;
		if (safeVisibleWidth(`…/${id}`) <= width) return `…/${id}`;
		return safeTruncateToWidth(`…${id}`, width, "…");
	}
	return safeTruncateToWidth(model, width, "…");
}

/** Model + cwd under the logo (no effort). Truncate long provider/id labels cleanly. */
function fitWelcomeMeta(model: string, cwd: string, width: number): string[] {
	return [truncateModelLabel(model, width), safeTruncateToWidth(cwd, width, "…")];
}

/** Pad lines equally above/below so a column cluster sits mid-height. */
function padVerticalCenter(lines: string[], targetHeight: number): string[] {
	const spare = Math.max(0, targetHeight - lines.length);
	const padTop = Math.floor(spare / 2);
	const padBottom = spare - padTop;
	return [
		...Array.from({ length: padTop }, () => ""),
		...lines,
		...Array.from({ length: padBottom }, () => ""),
	];
}

/**
 * Claude Code left column: greeting + logo + meta as one tight cluster.
 * Vertical centering is applied later (shared with the tips column).
 */
function balanceLeftColumn(
	greeting: string,
	logo: string[],
	meta: string[],
	leftWidth: number,
): string[] {
	return [
		centerText(greeting, leftWidth),
		"",
		...logo.map((line) => centerText(line, leftWidth)),
		"",
		...meta.map((line) => centerText(line, leftWidth)),
	];
}

/**
 * Hide Pi's built-in header (logo/tips) while capturing theme for the chat welcome.
 * Pi wraps the header slot with Spacer(1) above/below — an empty custom header still
 * leaves those blanks. Strip Spacers after Pi inserts the custom header (index is
 * captured before the factory runs, so we must not mutate siblings inside it).
 */
function stripHeaderSpacers(tui: { children?: unknown[] } | null | undefined): void {
	if (!tui || typeof tui !== "object") return;
	const rootChildren = tui.children;
	const headerContainer = Array.isArray(rootChildren) ? rootChildren[0] : undefined;
	const siblings = (headerContainer as { children?: unknown[] } | undefined)?.children;
	if (!Array.isArray(siblings)) return;
	(headerContainer as { children: unknown[] }).children = siblings.filter(
		(child) => !(child instanceof Spacer),
	);
}

export function setCompactStartupHeader(ui: ExtensionUIContext, cwd: string): void {
	if (isQuietStartup(cwd)) return;
	ui.setHeader((tui, theme) => {
		activeTheme = theme as ThemeLike;
		const strip = () => stripHeaderSpacers(tui as { children?: unknown[] });
		queueMicrotask(strip);
		setTimeout(strip, 0).unref?.();
		return {
			invalidate() {},
			render(): string[] {
				return [];
			},
		};
	});
}

export function suppressStartupModelScopeLog(): void {
	const consoleState = console as typeof console & { [CONSOLE_LOG_PATCHED]?: boolean };
	if (consoleState[CONSOLE_LOG_PATCHED]) return;
	consoleState[CONSOLE_LOG_PATCHED] = true;
	const originalLog = console.log.bind(console);
	console.log = (...args: unknown[]) => {
		const first = typeof args[0] === "string" ? args[0] : "";
		if (first.includes("Model scope:") && first.includes("Ctrl+P to cycle")) return;
		originalLog(...args);
	};
}

function renderClaudeWelcome(
	theme: ThemeLike,
	info: StartupInfo,
	systemContextItems: SystemContextItem[],
	width: number,
): string[] {
	const paint = (s: string) => theme.fg("accent", s);
	const muted = (s: string) => theme.fg("muted", s);
	const dim = (s: string) => theme.fg("dim", s);
	const bold = (s: string) => theme.bold(s);

	if (width < 24) return [`${paint("Pi")} ${muted(`v${VERSION}`)}`];

	const boxWidth = Math.max(24, width);
	const innerWidth = boxWidth - 2;
	const { leftWidth, rightWidth, useRight } = welcomeColumnWidths(innerWidth);
	const tipColWidth = useRight ? rightWidth : innerWidth;
	// Same gutter for Tips/What's new text and both dividers — keep left/right edges flush.
	const tipGutter = 1;
	const tipInnerWidth = Math.max(1, tipColWidth - tipGutter * 2);
	const tipDivider =
		`${" ".repeat(tipGutter)}${muted("─".repeat(tipInnerWidth))}${" ".repeat(tipGutter)}`;
	const tipLine = (text: string) =>
		`${" ".repeat(tipGutter)}${safeTruncateToWidth(text, tipInnerWidth, "…")}`;
	const bullet = (text: string) => `• ${text}`;

	const rightCluster: string[] = [
		tipLine(paint(bold("Tips for getting started"))),
		tipLine(bullet(`Run ${paint("/commands")} to browse all available commands`)),
		tipLine(bullet(`Use ${paint("/model")} to switch AI models`)),
		tipLine(bullet(`Open ${paint("/tree")} to browse and jump session branches`)),
	];

	if (systemContextItems.length > 0) {
		rightCluster.push(tipDivider);
		rightCluster.push(tipLine(paint(bold("Context"))));
		for (const item of systemContextItems) {
			const maxPath = Math.max(18, tipInnerWidth - 12);
			const path = item.path.length > maxPath
				? "…" + item.path.slice(-(maxPath - 1))
				: item.path;
			rightCluster.push(tipLine(bullet(`${dim(item.kind)}  ${paint(path)}`)));
		}
	}

	const whatsNew = getWhatsNewBullets();
	rightCluster.push(tipDivider);
	rightCluster.push(tipLine(paint(bold("What's new"))));
	if (whatsNew.length > 0) {
		for (const item of whatsNew) {
			rightCluster.push(tipLine(bullet(muted(item))));
		}
	} else {
		rightCluster.push(tipLine(bullet(muted(`Pi v${VERSION} — see release notes`))));
	}
	rightCluster.push(tipLine(`  ${paint("/changelog")} for more`));

	const logo = piLogoLines(theme);
	const metaWidth = useRight ? leftWidth : innerWidth;
	const [modelLine, cwdLine] = fitWelcomeMeta(info.model, info.cwd, metaWidth);
	const meta = [muted(modelLine), dim(cwdLine)];

	let bodyLines: string[];
	if (useRight) {
		const leftCluster = balanceLeftColumn(bold("Welcome back!"), logo, meta, leftWidth);
		// +2 so left always gets ≥1 blank above/below (was uneven when right ≈ left height).
		const targetHeight = Math.max(leftCluster.length, rightCluster.length) + 2;
		const leftLines = padVerticalCenter(leftCluster, targetHeight);
		const rightLines = padVerticalCenter(rightCluster, targetHeight);
		bodyLines = [];
		for (let i = 0; i < targetHeight; i++) {
			bodyLines.push(twoColumn(leftLines[i] ?? "", rightLines[i] ?? "", leftWidth, rightWidth, paint));
		}
	} else {
		// Narrow terminal: stack greeting → logo → tips → meta inside one box.
		bodyLines = [
			centerText(bold("Welcome back!"), innerWidth),
			"",
			...logo.map((line) => centerText(line, innerWidth)),
			"",
			...rightCluster,
			"",
			...meta.map((line) => centerText(line, innerWidth)),
		];
	}

	// Border title: Pi stays accent; version matches What's new body (muted gray).
	const titleLabel = `${paint("Pi")} ${muted(`v${VERSION}`)}`;
	const lines = [borderLine("╭", titleLabel, "╮", boxWidth, paint)];
	for (const content of bodyLines) {
		lines.push(boxedLine(content, boxWidth, paint));
	}
	lines.push(borderLine("╰", "", "╯", boxWidth, paint));
	return lines.map((line) => safeTruncateToWidth(line, boxWidth, ""));
}

class WelcomeBanner {
	constructor(
		private readonly theme: ThemeLike,
		private readonly info: StartupInfo,
		private readonly systemContextItems: SystemContextItem[],
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		// Match statusline/cli-dock full content width — do not inset with MESSAGE_TEXT_INDENT.
		return renderClaudeWelcome(this.theme, this.info, this.systemContextItems, Math.max(1, width));
	}
}

export function installStartupUiPatch(InteractiveModeComponent: any): void {
	const proto = InteractiveModeComponent?.prototype;
	if (!proto) return;
	// Save the true original on first patch only (persists across reloads via the prototype)
	if (!proto[TRUE_ORIGINAL]) {
		proto[TRUE_ORIGINAL] = proto.showLoadedResources;
	}
	// Always save reference to the true original for the current patch
	proto[ORIGINAL_SHOW_LOADED_RESOURCES] = proto[TRUE_ORIGINAL];
	proto[PATCHED] = true;

	proto.showLoadedResources = function showDroidLoadedResources(options?: { force?: boolean; showDiagnosticsWhenQuiet?: boolean; extensions?: Array<{ path: string; sourceInfo?: unknown }> }) {
		const original = this[ORIGINAL_SHOW_LOADED_RESOURCES];
		const showListing = options?.force || this.options?.verbose || !this.settingsManager?.getQuietStartup?.();
		if (!showListing) {
			return original.call(this, options);
		}

		// Same gate as Pi's getChangelogForDisplay — welcome is new-session only.
		const messageCount = this.session?.state?.messages?.length ?? 0;
		if (messageCount > 0) {
			return original.call(this, options);
		}

		const themes = this.session.resourceLoader.getThemes().themes.filter((loadedTheme: any) => loadedTheme.sourcePath);
		const extensions = options?.force && options?.extensions
			? options.extensions
			: this.session.resourceLoader.getExtensions().extensions.map((extension: any) => ({
				path: extension.path,
				sourceInfo: extension.sourceInfo,
			}));
		const contextFiles = this.session.resourceLoader.getAgentsFiles().agentsFiles;
		const scopedModels = this.session.scopedModels ?? [];
		const availableTools = getAvailableTools(this.session);
		const cwd = typeof this.sessionManager?.getCwd === "function" ? this.sessionManager.getCwd() : process.cwd();

		// Cache live session model/cwd for the Claude Code-style welcome
		startupInfo = {
			model: formatModelLabel(this.session.model, scopedModels),
			cwd: formatCwd(cwd),
		};

		const agentDir = getAgentDir();
		const systemPrompt = this.session.resourceLoader.getSystemPrompt?.();
		const appendSystemPrompts = this.session.resourceLoader.getAppendSystemPrompt?.() ?? [];
		const systemPromptPath = discoverPromptFile(cwd, agentDir, "SYSTEM.md");
		const appendSystemPromptPath = discoverPromptFile(cwd, agentDir, "APPEND_SYSTEM.md");
		const systemContextItems: SystemContextItem[] = [];

		if (typeof systemPrompt === "string") {
			const words = countWords(systemPrompt);
			const lines = countLines(systemPrompt);
			if (words > 0 && lines > 0) {
				systemContextItems.push({
					priority: 10,
					kind: "system",
					path: systemPromptPath ? this.formatContextPath(systemPromptPath) : "custom system prompt",
					words,
					lines,
				});
			}
		}

		appendSystemPrompts.forEach((content: string, index: number) => {
			const words = countWords(content);
			const lines = countLines(content);
			if (words <= 0 || lines <= 0) return;

			systemContextItems.push({
				priority: 20 + index,
				kind: "append",
				path: appendSystemPromptPath && index === 0 ? this.formatContextPath(appendSystemPromptPath) : `append system prompt ${index + 1}`,
				words,
				lines,
			});
		});

		contextFiles.forEach((file: any, index: number) => {
			const content = file.content ?? "";
			const words = countWords(content);
			const lines = countLines(content);
			if (words <= 0 || lines <= 0) return;

			systemContextItems.push({
				priority: 100 + index,
				kind: "context",
				path: this.formatContextPath(file.path),
				words,
				lines,
			});
		});

		// Welcome flush to the top; strip leftover header Spacers again (defensive).
		if (this.ui) stripHeaderSpacers(this.ui);
		const theme = activeTheme ?? FALLBACK_THEME;
		this.chatContainer.addChild(new WelcomeBanner(theme, startupInfo, systemContextItems));
		this.chatContainer.addChild(new Spacer(1));

		const getQuietStartup = this.settingsManager.getQuietStartup.bind(this.settingsManager);
		this.settingsManager.getQuietStartup = () => true;
		try {
			return original.call(this, { ...options, force: false, showDiagnosticsWhenQuiet: true });
		} finally {
			this.settingsManager.getQuietStartup = getQuietStartup;
		}
	};
}
