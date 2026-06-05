#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "theme-extras-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
}
declare module "node:os" {
	export const homedir: () => string;
}
declare module "node:path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare const process: any;
`, "utf8");
}

function compileThemeExtras() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:theme-extras");
	const result = spawnSync(process.execPath, [
		tsc,
		"--outDir", buildDir,
		"--rootDir", repoRoot,
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--target", "ES2022",
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		"theme/theme-extras.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc theme extras ok");
}

async function runThemeExtrasSmoke() {
	const themePath = join(workDir, "token-theme.json");
	writeFileSync(themePath, `${JSON.stringify({
		name: "token-smoke",
		vars: {
			accent: "#89b4fa",
			softBlue: "#89b4fa",
			blue: "softBlue",
			dim: "#6c7086",
			borderBase: "#313244",
		},
		colors: {
			borderMuted: "borderBase",
		},
		extras: {
			assistantPrefix: "accent",
			showDivider: false,
			quoteStyle: false,
			assistantPrefixColor: "blue",
			dividerColor: "borderMuted",
			slashHintColor: "dim",
			quoteColor: "missingToken",
		},
	}, null, 2)}\n`, "utf8");

	const themeExtras = await import(pathToFileURL(join(buildDir, "theme", "theme-extras.js")).href);
	const theme = { sourcePath: themePath };
	themeExtras.setFullTheme(theme, true);

	assert(themeExtras.getThemeExtra(theme, "assistantPrefix") === "accent", "non-color extra was resolved unexpectedly");
	assert(themeExtras.getThemeExtra(theme, "showDivider") === "false", "boolean false extra did not normalize to string false");
	assert(themeExtras.getThemeExtra(theme, "quoteStyle") === "false", "boolean quoteStyle extra did not normalize to string false");
	assert(themeExtras.getThemeExtra(theme, "assistantPrefixColor") === "#89b4fa", "var alias color extra did not resolve to hex");
	assert(themeExtras.getThemeExtra(theme, "dividerColor") === "#313244", "colors alias color extra did not resolve to hex");
	assert(themeExtras.getThemeExtra(theme, "slashHintColor") === "#6c7086", "direct var color extra did not resolve to hex");
	assert(themeExtras.getThemeExtra(theme, "userPrefixColor") === "#89b4fa", "default color extra token did not resolve to hex");
	assert(themeExtras.getThemeExtra(theme, "quoteColor") === "missingToken", "unresolved color token was not preserved");
	console.log("theme extras token smoke ok");
}

prepareWorkDir();
compileThemeExtras();
await runThemeExtrasSmoke();
