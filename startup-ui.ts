import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { getAgentDir, keyHint, rawKeyHint, VERSION } from "@mariozechner/pi-coding-agent";
import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";

const PATCHED = Symbol.for("pi-droid-styling.startup-ui.patched");
const ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-droid-styling.startup-ui.original-show-loaded-resources");
const CONSOLE_LOG_PATCHED = Symbol.for("pi-droid-styling.startup-ui.console-log-patched");
const SYSTEM_CONTEXT_PANEL_MIN_WIDTH = 64;
const PI_ASCII_LOGO = [
	".3141592653:",
	":. 59  26+",
	"   53 .58=",
	"  =97. .93 ..",
	" -23   *846.",
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

function plural(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function renderPanelTitle(theme: ThemeLike, title: string, panelWidth: number): string {
	const innerWidth = panelWidth + 2;
	const titleWidth = visibleWidth(title);
	const ruleWidth = Math.max(0, innerWidth - titleWidth - 2);
	const leftRuleWidth = Math.floor(ruleWidth / 2);
	const rightRuleWidth = ruleWidth - leftRuleWidth;
	return `┌${"─".repeat(leftRuleWidth)} ${theme.bold(theme.fg("accent", title))} ${"─".repeat(rightRuleWidth)}┐`;
}

function renderSystemContextPanel(theme: ThemeLike, items: SystemContextItem[], minTotalWidth = 0): string[] {
	const sortedItems = [...items].sort((a, b) => a.priority - b.priority);
	const title = `System & Context · ${plural(sortedItems.length, "file")}`;

	if (sortedItems.length === 0) {
		const message = "No system or context files loaded";
		const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - 4, visibleWidth(title) + 2, visibleWidth(message));
		const padding = " ".repeat(Math.max(0, panelWidth - visibleWidth(message)));
		return [
			renderPanelTitle(theme, title, panelWidth),
			`│ ${theme.fg("dim", message)}${padding} │`,
			`└${"─".repeat(panelWidth + 2)}┘`,
		];
	}

	const typeWidth = Math.max("type".length, ...sortedItems.map((item) => visibleWidth(item.kind)));
	const metricLabel = "words/lines";
	const metricWidth = Math.max(metricLabel.length, ...sortedItems.map((item) => `${item.words}/${item.lines}`.length));
	let pathWidth = Math.max("path".length, ...sortedItems.map((item) => visibleWidth(item.path)));
	const baseRowWidth = typeWidth + 2 + pathWidth + 2 + metricWidth;
	const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - 4, visibleWidth(title) + 2, baseRowWidth);
	pathWidth += panelWidth - baseRowWidth;
	const header = `${"type".padEnd(typeWidth)}  ${"path".padEnd(pathWidth)}  ${metricLabel.padStart(metricWidth)}`;
	const separator = `${"─".repeat(typeWidth)}  ${"─".repeat(pathWidth)}  ${"─".repeat(metricWidth)}`;
	const lines = [
		renderPanelTitle(theme, title, panelWidth),
		`│ ${theme.fg("muted", header)} │`,
		`│ ${theme.fg("muted", separator)} │`,
	];

	for (const item of sortedItems) {
		const metric = `${item.words}/${item.lines}`;
		const typePadding = " ".repeat(Math.max(0, typeWidth - visibleWidth(item.kind)));
		const pathPadding = " ".repeat(Math.max(0, pathWidth - visibleWidth(item.path)));
		const metricPadding = " ".repeat(Math.max(0, metricWidth - visibleWidth(metric)));
		lines.push(
			`│ ${theme.fg("mdHeading", item.kind)}${typePadding}  ${theme.fg("dim", item.path)}${pathPadding}  ${metricPadding}${theme.fg("success", metric)} │`,
		);
	}

	lines.push(`└${"─".repeat(panelWidth + 2)}┘`);
	return lines;
}

function renderResourceTable(theme: ThemeLike, rows: ResourceRow[], systemContextItems: SystemContextItem[], expanded: boolean): string {
	const total = rows.map((row) => `${row.label} ${theme.fg("success", String(row.items.length))}`).join(theme.fg("muted", " · "));
	const summary = theme.bold(theme.fg("accent", "◆ Resources")) + theme.fg("muted", total ? ` · ${total}` : "");
	if (!expanded) return summary;

	return [summary, "", ...renderSystemContextPanel(theme, systemContextItems, visibleWidth(summary))].join("\n");
}

function compactHeader(theme: ThemeLike): string {
	const logoWidth = Math.max(...PI_ASCII_LOGO.map((line) => visibleWidth(line)));
	const gap = "   ";
	const title = theme.bold(theme.fg("accent", "Pi")) + theme.fg("dim", ` v${VERSION}`);
	const hints = [
		theme.bold(rawKeyHint("/", "commands")),
		theme.bold(rawKeyHint("!", "bash")),
		theme.bold(keyHint("app.tools.expand", "more")),
	].join(theme.fg("muted", " · "));
	const status = `${theme.fg("success", "●")} ${theme.bold(theme.fg("success", "ready"))}`;
	const details = [title, hints, status, "", ""];

	return PI_ASCII_LOGO
		.map((line, index) => {
			const logoPadding = " ".repeat(Math.max(0, logoWidth - visibleWidth(line)));
			const detail = details[index] ?? "";
			return `${theme.fg("accent", line)}${logoPadding}${detail ? `${gap}${detail}` : ""}`;
		})
		.join("\n");
}

export function setCompactStartupHeader(ui: ExtensionUIContext, cwd: string): void {
	if (isQuietStartup(cwd)) return;
	ui.setHeader((_tui, theme) => {
		activeTheme = theme as ThemeLike;
		return new Text(compactHeader(activeTheme), 0, 0);
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
