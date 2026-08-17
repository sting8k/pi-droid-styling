import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type BundledTheme = {
	name: string;
	path: string;
};

type InteractiveModeLike = {
	prototype?: {
		bindCurrentSessionExtensions?: (...args: unknown[]) => Promise<unknown>;
		[COMPANION_THEME_STATE]?: CompanionThemeState;
	};
};

type CompanionThemeState = {
	pendingThemeReapply: boolean;
};

const BUNDLED_THEMES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "pi-themes", "themes");
const COMPANION_THEME_PATCHED = Symbol.for("pi-droid-styling.companion-themes.patched");
const COMPANION_THEME_STATE = Symbol.for("pi-droid-styling.companion-themes.state");

function loadBundledThemes(): BundledTheme[] {
	return readdirSync(BUNDLED_THEMES_DIR)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => {
			const path = join(BUNDLED_THEMES_DIR, file);
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown };
			if (typeof parsed.name !== "string" || parsed.name.length === 0) {
				throw new Error(`Bundled theme has no valid name: ${path}`);
			}
			return { name: parsed.name, path };
		});
}

function installThemeReapplyPatch(InteractiveMode: unknown, state: CompanionThemeState): void {
	const prototype = (InteractiveMode as InteractiveModeLike | null | undefined)?.prototype;
	if (!prototype || typeof prototype.bindCurrentSessionExtensions !== "function") return;
	prototype[COMPANION_THEME_STATE] = state;
	const current = prototype.bindCurrentSessionExtensions as typeof prototype.bindCurrentSessionExtensions & {
		[COMPANION_THEME_PATCHED]?: boolean;
	};
	if (current[COMPANION_THEME_PATCHED]) return;

	const original = current;
	const wrapped = async function (this: { themeController?: { applyFromSettings?: () => Promise<void> } }, ...args: unknown[]) {
		const result = await original.apply(this, args);
		const activeState = prototype[COMPANION_THEME_STATE];
		if (activeState?.pendingThemeReapply) {
			activeState.pendingThemeReapply = false;
			await this.themeController?.applyFromSettings?.();
		}
		return result;
	};
	wrapped[COMPANION_THEME_PATCHED] = true;
	prototype.bindCurrentSessionExtensions = wrapped;
}

export function registerCompanionThemes(pi: ExtensionAPI, InteractiveMode: unknown): void {
	const bundledThemes = loadBundledThemes();
	const state: CompanionThemeState = { pendingThemeReapply: false };
	installThemeReapplyPatch(InteractiveMode, state);
	pi.on("resources_discover", (_event, ctx) => {
		const existingNames = new Set(ctx.ui.getAllThemes().map((theme) => theme.name));
		const themePaths = bundledThemes.filter((theme) => !existingNames.has(theme.name)).map((theme) => theme.path);
		state.pendingThemeReapply = themePaths.length > 0;
		return { themePaths };
	});
}
