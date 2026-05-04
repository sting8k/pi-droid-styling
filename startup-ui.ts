import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { keyHint, rawKeyHint, VERSION } from "@mariozechner/pi-coding-agent";
import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { Spacer, Text } from "@mariozechner/pi-tui";

const PATCHED = Symbol.for("pi-droid-styling.startup-ui.patched");
const ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-droid-styling.startup-ui.original-show-loaded-resources");
const COMPACT_LIST_LIMIT = 4;
const RESOURCE_KIND_WIDTH = 10;
const RESOURCE_COUNT_WIDTH = 5;

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

function formatItems(theme: ThemeLike, items: string[], expanded: boolean): string {
	const sorted = [...items].map((item) => item.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
	const visible = expanded ? sorted : sorted.slice(0, COMPACT_LIST_LIMIT);
	const suffix = !expanded && sorted.length > visible.length ? theme.fg("muted", `  +${sorted.length - visible.length}`) : "";
	return theme.fg("dim", visible.join(theme.fg("muted", ", "))) + suffix;
}

function plural(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function renderResourceTable(theme: ThemeLike, rows: ResourceRow[], expanded: boolean): string {
	const total = rows.map((row) => plural(row.items.length, row.label.replace(/s$/, ""))).join(theme.fg("muted", " · "));
	const lines = [theme.bold(theme.fg("accent", "Resources")) + theme.fg("muted", total ? ` · ${total}` : "")];
	for (const row of rows) {
		const kind = theme.fg("mdHeading", row.label.padEnd(RESOURCE_KIND_WIDTH, " "));
		const count = theme.fg("success", String(row.items.length).padStart(RESOURCE_COUNT_WIDTH, " "));
		lines.push(`  ${kind}  ${count}  ${formatItems(theme, row.items, expanded)}`);
	}
	return lines.join("\n");
}

function compactHeader(theme: ThemeLike): string {
	const title = theme.bold(theme.fg("accent", "◆ Pi")) + theme.fg("dim", ` v${VERSION}`);
	const hints = [
		theme.bold(rawKeyHint("/", "commands")),
		theme.bold(rawKeyHint("!", "bash")),
		theme.bold(keyHint("app.tools.expand", "more")),
	].join(theme.fg("muted", " · "));
	return `${title}${theme.fg("muted", " · ")}${hints}`;
}

export function setCompactStartupHeader(ui: ExtensionUIContext, cwd: string): void {
	if (isQuietStartup(cwd)) return;
	ui.setHeader((_tui, theme) => {
		activeTheme = theme as ThemeLike;
		return new Text(compactHeader(activeTheme), 1, 0);
	});
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

		const rows: ResourceRow[] = [
			{ label: "context", items: contextFiles.map((file: any) => this.formatContextPath(file.path)) },
			{ label: "skills", items: skills.map((skill: any) => skill.name) },
			{ label: "prompts", items: templates.map((template: any) => `/${template.name}`) },
			{ label: "extensions", items: this.getCompactExtensionLabels(extensions) },
			{ label: "themes", items: themes.map((loadedTheme: any) => loadedTheme.name ?? this.getCompactPathLabel(loadedTheme.sourcePath, loadedTheme.sourceInfo)) },
		].filter((row) => row.items.length > 0);

		if (rows.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
			const theme = activeTheme ?? FALLBACK_THEME;
			this.chatContainer.addChild(new ExpandableText(
				() => renderResourceTable(theme, rows, false),
				() => renderResourceTable(theme, rows, true),
				Boolean(this.options?.verbose),
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
