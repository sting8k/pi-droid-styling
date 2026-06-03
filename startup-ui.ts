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

function renderPanelBorder(theme: ThemeLike, left: string, right: string, panelWidth: number): string {
	return theme.fg("dim", `${left}${"─".repeat(panelWidth + STARTUP_PANEL_SIDE_PADDING * 2)}${right}`);
}

function renderPanelLine(theme: ThemeLike, content: string, panelWidth: number): string {
	const sidePadding = " ".repeat(STARTUP_PANEL_SIDE_PADDING);
	const padding = " ".repeat(Math.max(0, panelWidth - safeVisibleWidth(content)));
	return `${theme.fg("dim", "│")}${sidePadding}${content}${padding}${sidePadding}${theme.fg("dim", "│")}`;
}

function renderSystemContextPanel(theme: ThemeLike, items: SystemContextItem[], minTotalWidth = 0): string[] {
	const sortedItems = [...items].sort((a, b) => a.priority - b.priority);
	const titleLabel = "System & Context";
	const titleLine = theme.bold(theme.fg("accent", titleLabel));
	const outerWidth = STARTUP_PANEL_SIDE_PADDING * 2 + 2;

	if (sortedItems.length === 0) {
		const message = theme.fg("dim", "No system or context files loaded");
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
	let pathWidth = Math.max(pathHeader.length, ...sortedItems.map((item) => safeVisibleWidth(item.path)));
	const baseRowWidth = typeWidth + columnDividerWidth + pathWidth + columnDividerWidth + metricWidth;
	const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine), baseRowWidth);
	pathWidth += panelWidth - baseRowWidth;
	const header = `${theme.fg("muted", typeHeader.padEnd(typeWidth))}${columnDivider}${theme.fg("muted", pathHeader.padEnd(pathWidth))}${columnDivider}${theme.fg("muted", metricLabel.padStart(metricWidth))}`;
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
		const pathPadding = " ".repeat(Math.max(0, pathWidth - safeVisibleWidth(item.path)));
		const metricPadding = " ".repeat(Math.max(0, metricWidth - safeVisibleWidth(metric)));
		lines.push(renderPanelLine(
			theme,
			`${theme.fg("dim", item.kind)}${typePadding}${columnDivider}${theme.fg("dim", item.path)}${pathPadding}${columnDivider}${metricPadding}${theme.fg("dim", metric)}`,
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

function renderResourceTable(theme: ThemeLike, rows: ResourceRow[], systemContextItems: SystemContextItem[], expanded: boolean): string {
	const primaryLabel = systemContextItems.some((item) => item.kind === "system") ? "system" : rows[0]?.label;
	const total = rows
		.map((row) => renderResourceChip(theme, row, row.label === primaryLabel))
		.join(theme.fg("dim", RESOURCE_ROW_GAP));
	const summary = theme.bold(theme.fg("accent", "◆")) + MESSAGE_TEXT_INDENT.slice(1) + theme.bold(theme.fg("accent", "Resources")) + theme.fg("dim", total ? RESOURCE_ROW_GAP : "") + total;
	if (!expanded) return summary;

	const panelBodyWidth = Math.max(1, safeVisibleWidth(summary) - safeVisibleWidth(MESSAGE_TEXT_INDENT));
	return [summary, "", ...indentStartupLines(renderSystemContextPanel(theme, systemContextItems, panelBodyWidth))].join("\n");
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
				() => renderResourceTable(theme, rows, systemContextItems, false),
				() => renderResourceTable(theme, rows, systemContextItems, true),
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
