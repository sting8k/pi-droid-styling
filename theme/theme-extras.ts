// Theme extras reader
// Reads extension-specific "extras" plus raw theme vars/export values from
// the active theme's JSON file on disk. The framework doesn't expose all of
// these raw values via theme.definition, so we locate and parse the file directly.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));

const HARDCODED_DEFAULTS: Record<string, string> = {
	assistantPrefix: "•",
	assistantPrefixColor: "",
	userPrefix: "❯",
	userPrefixColor: "accent",
	dividerChar: "─",
	dividerColor: "",
	showDivider: "true",
	quoteStyle: "false",
	quoteChar: "┆",
	quoteColor: "",
	inputBorderColor: "",
	bashPromptColor: "",
	tagBgColor: "",
	parensTextColor: "",
	parensBracketColor: "",
	slashSelectedColor: "",
	slashCommandColor: "",
	slashDescriptionColor: "",
	slashHintColor: "",
	userBoxBorderColor: "",
	gitInsertionColor: "#2ea043",
	gitDeletionColor: "#f85149",
};

let cachedExtras: Record<string, string> | null = null;
let cachedVars: Record<string, string> | null = null;
let cachedThemeExport: Record<string, string> | null = null;
let cachedThemeName: string | null = null;

type ThemeDiscovery = {
	extras: Record<string, string> | null;
	vars: Record<string, string> | null;
	themeExport: Record<string, string> | null;
};

function readThemeDiscoveryFromPath(filePath: string): ThemeDiscovery | null {
	try {
		if (!filePath || !existsSync(filePath)) return null;
		const content = JSON.parse(readFileSync(filePath, "utf-8"));
		const extras = content?.extras && typeof content.extras === "object"
			? content.extras as Record<string, string>
			: null;
		const vars = content?.vars && typeof content.vars === "object"
			? content.vars as Record<string, string>
			: null;
		const themeExport = content?.export && typeof content.export === "object"
			? content.export as Record<string, string>
			: null;
		return extras || vars || themeExport ? { extras, vars, themeExport } : null;
	} catch {
		return null;
	}
}

function resolveThemeSourcePath(theme: any): string {
	return typeof theme?.sourcePath === "string"
		? theme.sourcePath
		: typeof theme?.definition?.sourcePath === "string"
			? theme.definition.sourcePath
			: "";
}

function addThemeDir(searchDirs: Set<string>, dir: string): void {
	if (existsSync(dir)) searchDirs.add(dir);
}

function addBundledThemeDirs(searchDirs: Set<string>): void {
	for (const root of [extensionDir, process.cwd()]) {
		for (const scope of ["@earendil-works", "@mariozechner"]) {
			addThemeDir(searchDirs, resolve(root, "node_modules", scope, "pi-coding-agent", "dist", "modes", "interactive", "theme"));
			addThemeDir(searchDirs, resolve(root, "node_modules", scope, "pi-coding-agent", "dist", "theme"));
		}
	}
}

function collectThemeDirs(root: string, searchDirs: Set<string>, maxDepth = 4): void {
	if (maxDepth < 0 || !existsSync(root)) return;
	try {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const dir = join(root, entry.name);
			if (entry.name === "themes") {
				searchDirs.add(dir);
				continue;
			}
			collectThemeDirs(dir, searchDirs, maxDepth - 1);
		}
	} catch {}
}

function readSettingsPackagePaths(settingsPath: string): string[] {
	if (!existsSync(settingsPath)) return [];
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const entries = [
			...(Array.isArray(settings.packages) ? settings.packages : []),
			...(Array.isArray(settings.extensions) ? settings.extensions : []),
		];
		return entries
			.map((entry) => typeof entry === "string" ? entry : typeof entry?.source === "string" ? entry.source : "")
			.filter((entry) => entry && !entry.startsWith("npm:") && !entry.startsWith("git:"));
	} catch {
		return [];
	}
}

/**
 * Scan known theme directories for a JSON file whose "name" matches themeName.
 * Returns parsed extras/vars/export data, or null if not found.
 */
function discoverThemeExtras(themeName: string): ThemeDiscovery | null {
	const searchDirs = new Set<string>();

	// 1. Global/project top-level theme dirs.
	addThemeDir(searchDirs, join(homedir(), ".pi", "agent", "themes"));
	addThemeDir(searchDirs, resolve(process.cwd(), ".pi", "themes"));
	addBundledThemeDirs(searchDirs);

	// 2. Installed git packages. Pi clones git packages under:
	//    ~/.pi/agent/git/<host>/<user>/<repo> and <cwd>/.pi/git/<host>/<user>/<repo>.
	collectThemeDirs(join(homedir(), ".pi", "agent", "git"), searchDirs);
	collectThemeDirs(resolve(process.cwd(), ".pi", "git"), searchDirs);

	// 3. Explicit local package paths from global/project settings.
	const localPackagePaths = [
		...readSettingsPackagePaths(join(homedir(), ".pi", "agent", "settings.json")),
		...readSettingsPackagePaths(resolve(process.cwd(), ".pi", "settings.json")),
	];
	for (const packagePath of localPackagePaths) {
		addThemeDir(searchDirs, resolve(process.cwd(), packagePath, "themes"));
	}

	// Search all directories for matching theme file
	for (const dir of searchDirs) {
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".json")) continue;
				const filePath = join(dir, file);
				try {
					const content = JSON.parse(readFileSync(filePath, "utf-8"));
					if (content?.name === themeName) {
						const result = readThemeDiscoveryFromPath(filePath);
						if (result) return result;
					}
				} catch {}
			}
		} catch {}
	}

	return null;
}

function resolveThemeName(theme: any): string | null {
	// Try various paths the theme object might expose the name
	if (typeof theme?.definition?.name === "string") return theme.definition.name;
	if (typeof theme?.name === "string") return theme.name;
	// Try reading from settings as last resort
	try {
		const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
		if (existsSync(settingsPath)) {
			const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			if (typeof settings.theme === "string") return settings.theme;
		}
	} catch {}
	return null;
}

export function setFullTheme(theme: any, force = false): void {
	const themeName = resolveThemeName(theme);
	const sourcePath = resolveThemeSourcePath(theme);
	if (!themeName && !sourcePath) return;

	const cacheKey = sourcePath || themeName;
	// Only re-scan if theme changed, unless caller is syncing after a theme reload.
	if (!force && cacheKey === cachedThemeName && (cachedExtras !== null || cachedVars !== null || cachedThemeExport !== null)) return;

	cachedThemeName = cacheKey;
	const result = readThemeDiscoveryFromPath(sourcePath) ?? (themeName ? discoverThemeExtras(themeName) : null);
	cachedExtras = result?.extras ?? null;
	cachedVars = result?.vars ?? null;
	cachedThemeExport = result?.themeExport ?? null;
}

export function getThemeExtra(_theme: any, key: string): string {
	// If extras haven't been loaded yet, try resolving from theme or settings
	if (cachedExtras === null && cachedVars === null && cachedThemeExport === null && cachedThemeName === null) {
		const themeName = resolveThemeName(_theme);
		if (themeName) {
			cachedThemeName = themeName;
			const result = discoverThemeExtras(themeName);
			cachedExtras = result?.extras ?? null;
			cachedVars = result?.vars ?? null;
			cachedThemeExport = result?.themeExport ?? null;
		}
	}

	if (cachedExtras && typeof cachedExtras[key] === "string") {
		return cachedExtras[key];
	}
	return HARDCODED_DEFAULTS[key] ?? "";
}

function ensureThemeExportLoaded(theme: any): void {
	if (cachedExtras !== null || cachedVars !== null || cachedThemeExport !== null || cachedThemeName !== null) return;
	const themeName = resolveThemeName(theme);
	const sourcePath = resolveThemeSourcePath(theme);
	if (!themeName && !sourcePath) return;
	cachedThemeName = sourcePath || themeName;
	const result = readThemeDiscoveryFromPath(sourcePath) ?? (themeName ? discoverThemeExtras(themeName) : null);
	cachedExtras = result?.extras ?? null;
	cachedVars = result?.vars ?? null;
	cachedThemeExport = result?.themeExport ?? null;
}

function isHexColor(value: string): boolean {
	return /^#?[0-9a-fA-F]{3}$/.test(value) || /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

function resolveThemeExportColor(key: string): string {
	if (!cachedThemeExport) return "";
	const value = cachedThemeExport[key];
	if (typeof value !== "string" || !value) return "";
	const resolved = cachedVars && typeof cachedVars[value] === "string" ? cachedVars[value] : value;
	return isHexColor(resolved) ? resolved : "";
}

export function getThemePageBackground(theme: any): string {
	ensureThemeExportLoaded(theme);
	const directBg = cachedVars && typeof cachedVars.bg === "string" ? cachedVars.bg : "";
	if (isHexColor(directBg)) return directBg;
	return resolveThemeExportColor("pageBg");
}

export function getThemeVarBackground(theme: any, varName: string): string {
	ensureThemeExportLoaded(theme);
	const value = cachedVars && typeof cachedVars[varName] === "string" ? cachedVars[varName] : "";
	const resolved = cachedVars && value && typeof cachedVars[value] === "string" ? cachedVars[value] : value;
	return isHexColor(resolved) ? resolved : "";
}
