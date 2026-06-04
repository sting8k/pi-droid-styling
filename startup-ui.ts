import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { getAgentDir, keyHint, rawKeyHint, VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Spacer, Text } from "@earendil-works/pi-tui";
import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";

const PATCHED = Symbol.for("pi-droid-styling.startup-ui.patched");
const ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-droid-styling.startup-ui.original-show-loaded-resources");
const CONSOLE_LOG_PATCHED = Symbol.for("pi-droid-styling.startup-ui.console-log-patched");
const SYSTEM_CONTEXT_PANEL_MIN_WIDTH = 64;
const TOOLS_PANEL_MIN_WIDTH = 64;
const CORE_TOOL_SOURCE_LABEL = "core";
const MESSAGE_TEXT_INDENT = "   ";
const STARTUP_PANEL_SIDE_PADDING = 2;
const SYSTEM_CONTEXT_TYPE_WIDTH = safeVisibleWidth("System & Context");
const SYSTEM_CONTEXT_METRIC_WIDTH = safeVisibleWidth("Words/Lines");
const RESOURCE_ROW_GAP = "  ·  ";
const PI_ASCII_LOGO = [
	"┏━━━┓ ┏━┓",
	"┃ _ ┃ ┃ ┃",
	"┣━━━┛ ┃ ┃",
	"┗━┛   ┗━┛",
] as const;

let activeTheme: ThemeLike | undefined;
const FALLBACK_THEME: ThemeLike = {
	bold: (text) => text,
	fg: (_color, text) => text,
};

type ThemeLike = {
	bold(text: string): string;
	fg(color: string, text: string): string;
};

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

function startupBodyWidth(width: number): number {
	return Math.max(1, width - safeVisibleWidth(MESSAGE_TEXT_INDENT));
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

function compactHeader(theme: ThemeLike, width: number): string {
	const logoWidth = Math.max(...PI_ASCII_LOGO.map((line) => safeVisibleWidth(line)));
	const gap = "   ";
	const title = theme.bold(theme.fg("accent", "Pi")) + theme.fg("dim", ` v${VERSION}`);
	const hints = [
		theme.bold(rawKeyHint("/", "commands")),
		theme.bold(rawKeyHint("!", "bash")),
		theme.bold(keyHint("app.tools.expand", "more")),
	].join(theme.fg("muted", " · "));
	const status = `${theme.fg("success", "●")} ${theme.bold(theme.fg("success", "ready"))}`;
	const details = [title, hints, status, ""];
	const safeWidth = Math.max(1, width);
	const detailWidth = safeWidth - logoWidth - safeVisibleWidth(gap);

	if (detailWidth >= 12) {
		return PI_ASCII_LOGO
			.map((line, index) => {
				const logoPadding = " ".repeat(Math.max(0, logoWidth - safeVisibleWidth(line)));
				const detail = details[index] ? safeTruncateToWidth(details[index]!, detailWidth, "…") : "";
				return `${theme.fg("accent", line)}${logoPadding}${detail ? `${gap}${detail}` : ""}`;
			})
			.join("\n");
	}

	if (safeWidth >= logoWidth) {
		return [
			...PI_ASCII_LOGO.map((line) => theme.fg("accent", line)),
			safeTruncateToWidth(title, safeWidth, "…"),
			safeTruncateToWidth(hints, safeWidth, "…"),
			safeTruncateToWidth(status, safeWidth, "…"),
		].join("\n");
	}

	return [title, status].map((line) => safeTruncateToWidth(line, safeWidth, "…")).join("\n");
}

export function setCompactStartupHeader(ui: ExtensionUIContext, cwd: string): void {
	if (isQuietStartup(cwd)) return;
	ui.setHeader((_tui, theme) => {
		const headerTheme = theme as ThemeLike;
		activeTheme = headerTheme;
		return {
			invalidate() {},
			render(width: number): string[] {
				return indentStartupLines(compactHeader(headerTheme, startupBodyWidth(width)).split("\n"));
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

export function installStartupUiPatch(InteractiveModeComponent: any): void {
	const proto = InteractiveModeComponent?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;
	proto[ORIGINAL_SHOW_LOADED_RESOURCES] ??= proto.showLoadedResources;

	proto.showLoadedResources = function showDroidLoadedResources(options?: { force?: boolean; showDiagnosticsWhenQuiet?: boolean; extensions?: Array<{ path: string; sourceInfo?: unknown }> }) {
		const original = this[ORIGINAL_SHOW_LOADED_RESOURCES];
		const showListing = options?.force || this.options?.verbose || !this.settingsManager?.getQuietStartup?.();
		if (!showListing) {
			return original.call(this, options);
		}

		const skills = this.session.resourceLoader.getSkills().skills;
		const templates = this.session.promptTemplates ?? [];
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

		const rows: ResourceRow[] = [
			{ label: "system", items: systemContextItems.filter((item) => item.kind === "system").map((item) => item.path) },
			{ label: "append", items: systemContextItems.filter((item) => item.kind === "append").map((item) => item.path) },
			{ label: "context", items: systemContextItems.filter((item) => item.kind === "context").map((item) => item.path) },
			{ label: "models", items: scopedModels.map((scoped: any) => `${scoped.model.provider}/${scoped.model.id}`) },
			{ label: "tools", items: availableTools.map((tool) => tool.name) },
			{ label: "skills", items: skills.map((skill: any) => skill.name) },
			{ label: "prompts", items: templates.map((template: any) => `/${template.name}`) },
			{ label: "extensions", items: this.getCompactExtensionLabels(extensions) },
			{ label: "themes", items: themes.map((loadedTheme: any) => loadedTheme.name ?? this.getCompactPathLabel(loadedTheme.sourcePath, loadedTheme.sourceInfo)) },
		].filter((row) => row.items.length > 0);

		if (rows.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
			const theme = activeTheme ?? FALLBACK_THEME;
			const expanded = typeof this.getStartupExpansionState === "function"
				? this.getStartupExpansionState()
				: Boolean(this.options?.verbose);
			this.chatContainer.addChild(new ExpandableText(
				() => renderResourceTable(theme, rows, systemContextItems, availableTools, false),
				() => renderResourceTable(theme, rows, systemContextItems, availableTools, true),
				expanded,
				0,
				0,
			));
			this.chatContainer.addChild(new Spacer(1));
		}

		const getQuietStartup = this.settingsManager.getQuietStartup.bind(this.settingsManager);
		this.settingsManager.getQuietStartup = () => true;
		try {
			return original.call(this, { ...options, force: false, showDiagnosticsWhenQuiet: true });
		} finally {
			this.settingsManager.getQuietStartup = getQuietStartup;
		}
	};
}
