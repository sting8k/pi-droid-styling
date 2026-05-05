// Theme extras reader
// Reads extension-specific "extras" from the active theme's JSON file on disk.
// Since "extras" is not part of the official pi theme schema, the framework
// doesn't expose it via theme.definition. We locate and parse the file directly.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HARDCODED_DEFAULTS: Record<string, string> = {
	assistantPrefix: "•",
	assistantPrefixColor: "",
	userPrefix: "»",
	userPrefixColor: "",
	dividerChar: "─",
	dividerColor: "",
	showDivider: "true",
	quoteStyle: "false",
	quoteChar: "┃",
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
let cachedThemeName: string | null = null;

function addThemeDir(searchDirs: Set<string>, dir: string): void {
	if (existsSync(dir)) searchDirs.add(dir);
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
 * Returns the parsed extras object, or null if not found.
 */
function discoverThemeExtras(themeName: string): { extras: Record<string, string> | null; vars: Record<string, string> | null } | null {
	const searchDirs = new Set<string>();

	// 1. Global/project top-level theme dirs.
	addThemeDir(searchDirs, join(homedir(), ".pi", "agent", "themes"));
	addThemeDir(searchDirs, resolve(process.cwd(), ".pi", "themes"));

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
						const extras = content?.extras && typeof content.extras === "object"
							? content.extras as Record<string, string>
							: null;
						const vars = content?.vars && typeof content.vars === "object"
							? content.vars as Record<string, string>
							: null;
						if (extras || vars) return { extras, vars };
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

export function setFullTheme(theme: any): void {
	const themeName = resolveThemeName(theme);
	if (!themeName) return;

	// Only re-scan if theme changed
	if (themeName === cachedThemeName && cachedExtras !== null) return;

	cachedThemeName = themeName;
	const result = discoverThemeExtras(themeName);
	cachedExtras = result?.extras ?? null;
	cachedVars = result?.vars ?? null;
}

export function getThemeExtra(_theme: any, key: string): string {
	// If extras haven't been loaded yet, try resolving from theme or settings
	if (cachedExtras === null && cachedVars === null && cachedThemeName === null) {
		const themeName = resolveThemeName(_theme);
		if (themeName) {
			cachedThemeName = themeName;
			const result = discoverThemeExtras(themeName);
			cachedExtras = result?.extras ?? null;
			cachedVars = result?.vars ?? null;
		}
	}

	if (cachedExtras && typeof cachedExtras[key] === "string") {
		return cachedExtras[key];
	}
	return HARDCODED_DEFAULTS[key] ?? "";
}

export function getThemeVar(key: string): string {
	if (cachedVars && typeof cachedVars[key] === "string") {
		return cachedVars[key];
	}
	return "";
}
