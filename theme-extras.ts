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

/**
 * Scan known theme directories for a JSON file whose "name" matches themeName.
 * Returns the parsed extras object, or null if not found.
 */
function discoverThemeExtras(themeName: string): { extras: Record<string, string> | null; vars: Record<string, string> | null } | null {
	const searchDirs: string[] = [];

	// 1. Global themes
	const globalThemes = join(homedir(), ".pi", "agent", "themes");
	if (existsSync(globalThemes)) searchDirs.push(globalThemes);

	// 2. Project themes
	const projectThemes = resolve(process.cwd(), ".pi", "themes");
	if (existsSync(projectThemes)) searchDirs.push(projectThemes);

	// 3. Installed packages — scan ~/.pi/agent/git/*/themes and known package paths
	const gitDir = join(homedir(), ".pi", "agent", "git");
	if (existsSync(gitDir)) {
		try {
			for (const entry of readdirSync(gitDir, { withFileTypes: true })) {
				if (entry.isDirectory()) {
					const pkgThemes = join(gitDir, entry.name, "themes");
					if (existsSync(pkgThemes)) searchDirs.push(pkgThemes);
				}
			}
		} catch {}
	}

	// 4. Read settings.json to find package paths that might contain themes
	try {
		const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
		if (existsSync(settingsPath)) {
			const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			const allPaths: string[] = [
				...(Array.isArray(settings.packages) ? settings.packages : []),
				...(Array.isArray(settings.extensions) ? settings.extensions : []),
			];
			for (const p of allPaths) {
				if (typeof p !== "string" || p.startsWith("npm:") || p.startsWith("git:")) continue;
				// Local path — check for themes/ subdirectory
				const pkgThemes = join(p, "themes");
				if (existsSync(pkgThemes)) searchDirs.push(pkgThemes);
			}
		}
	} catch {}

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
