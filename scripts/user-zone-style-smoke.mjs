#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "user-zone-style-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function stripAnsi(text) {
	return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
}
declare module "node:path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
}
declare module "os" {
	export const homedir: () => string;
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:os" {
	export const homedir: () => string;
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare module "node:child_process" {
	export const execFileSync: any;
	export const spawn: any;
	export const spawnSync: any;
}
declare module "child_process" {
	export const execFileSync: any;
	export const spawn: any;
	export const spawnSync: any;
}
declare const process: any;
declare type Buffer = any;
declare const Buffer: any;
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:user-zone-style");
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
		"user-zone/designs.ts",
		"config.ts",
		"editor/box-editor.ts",
		"fixed-zone/install.ts",
		"fixed-zone/terminal-split.ts",
		"index.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc focused ok");
}

async function importBuilt(relativePath) {
	importCounter += 1;
	return import(`${pathToFileURL(join(buildDir, relativePath)).href}?smoke=${importCounter}`);
}

function writeInitialConfig(homeDir, initialJson) {
	if (initialJson === undefined) return;
	const configDir = join(homeDir, ".pi", "agent");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "pi-droid-styling.json"), `${initialJson}\n`, "utf8");
}

async function runConfigSmoke(name, initialJson, validate) {
	const homeDir = join(workDir, `home-${name.replace(/[^a-z0-9]+/gi, "-")}`);
	mkdirSync(homeDir, { recursive: true });
	writeInitialConfig(homeDir, initialJson);
	process.env.HOME = homeDir;
	const { loadConfig } = await importBuilt("config.js");
	const config = loadConfig();
	const raw = JSON.parse(readFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), "utf8"));
	validate({ config, raw });
	console.log(`config smoke ok: ${name}`);
}

async function runStyleResolverSmoke() {
	const styles = await importBuilt("user-zone/designs.js");
	assert(styles.USER_ZONE_STYLE_NAMES.join(",") === "droid,compact,minimal", "style names changed unexpectedly");
	assert(styles.resolveUserZoneStyle("droid").editor.showHostBorder === true, "droid style did not preserve host border");
	assert(styles.resolveUserZoneStyle("compact").editor.showDivider === false, "compact style did not hide divider");
	assert(styles.resolveUserZoneStyle("minimal").fixed.showScrollbar === false, "minimal style did not hide scrollbar");
	assert(styles.resolveUserZoneStyle("unknown").name === "droid", "unknown style did not resolve to droid");
	assert(styles.resolveUserZoneStyle("toString").name === "droid", "inherited object key did not resolve to droid");
	console.log("style resolver smoke ok");
}

function makeTheme() {
	return {
		borderColor: (text) => text,
		selectList: {},
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
		inverse: (text) => text,
	};
}

async function runBoxEditorSmoke() {
	const { BoxEditor } = await importBuilt("editor/box-editor.js");
	const { resolveUserZoneStyle } = await importBuilt("user-zone/designs.js");
	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const keybindings = { matches: () => false };
	const usage = () => ({ tokens: 12000, percent: 25, contextWindow: 48000 });
	const model = () => ({ provider: "openai", id: "gpt-test", reasoning: false });
	const branch = () => ({ branch: "main", insertions: 2, deletions: 1 });
	const speed = () => 42;
	const footer = () => "ready";

	const renderStyle = (styleName) => {
		const editor = new BoxEditor(
			tui,
			makeTheme(),
			keybindings,
			makeTheme(),
			"/tmp/pi-droid-style-smoke",
			usage,
			model,
			branch,
			speed,
			footer,
			() => "footer",
			resolveUserZoneStyle(styleName),
		);
		editor.setText("hello");
		return editor.render(88).map(stripAnsi);
	};

	const droid = renderStyle("droid");
	const compact = renderStyle("compact");
	const minimal = renderStyle("minimal");
	assert(droid.length === 6, `droid should preserve 6-row editor shell, got ${droid.length}`);
	assert(droid.some((line) => line.includes("== [")), "droid host border missing");
	assert(compact.length === 3, `compact should render metadata/runtime/input rows, got ${compact.length}`);
	assert(!compact.some((line) => line.includes("== [")), "compact should hide host border");
	assert(minimal.length === 1, `minimal should render input-only row, got ${minimal.length}`);
	assert(minimal[0]?.includes("hello"), "minimal input row missing editor text");
	console.log("box editor style smoke ok");
}

async function runFixedZoneSmoke() {
	const { TerminalSplitCompositor } = await importBuilt("fixed-zone/terminal-split.js");
	const { resolveUserZoneStyle } = await importBuilt("user-zone/designs.js");

	function run(styleName) {
		let rawRows = 18;
		let output = "";
		const terminal = {
			columns: 88,
			get rows() { return rawRows; },
			set rows(value) { rawRows = value; },
			write(data) { output += String(data); },
		};
		const rootLines = Array.from({ length: 80 }, (_value, index) => `root ${index}`);
		const tui = {
			terminal,
			render: () => rootLines,
			requestRender() { this.doRender?.(); },
			doRender() {
				const lines = this.render(this.terminal.columns);
				this.terminal.write(`${lines.join("\n")}\n`);
			},
		};
		const hidden = [{ target: { render: () => [] }, render: () => ["editor"] }];
		const compositor = new TerminalSplitCompositor(tui, hidden, { userZoneStyle: resolveUserZoneStyle(styleName) });
		compositor.install();
		tui.doRender();
		output = "";
		compositor.handleInput("\x1b[<64;10;5M");
		compositor.dispose();
		return output;
	}

	assert(run("compact").includes("▌"), "compact fixed-zone scrollbar glyph was not painted after scroll");
	assert(!run("minimal").includes("▌"), "minimal fixed-zone should not paint scrollbar glyph");
	console.log("fixed-zone style smoke ok");
}

prepareWorkDir();
compileChangedSurface();

await runConfigSmoke("scaffold default style", undefined, ({ config, raw }) => {
	assert(raw.userZoneStyle === "droid", "scaffold did not write default userZoneStyle");
	assert(config.userZoneStyle === "droid", "default config did not normalize to droid");
});

await runConfigSmoke("valid style preserved", '{"userZoneStyle":"compact"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "compact", "valid userZoneStyle was not preserved");
	assert(config.userZoneStyle === "compact", "valid userZoneStyle did not normalize");
});

await runConfigSmoke("invalid style backfilled", '{"userZoneStyle":"ghost"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "droid", "invalid userZoneStyle was not backfilled to droid");
	assert(config.userZoneStyle === "droid", "invalid userZoneStyle did not normalize to droid");
});

await runConfigSmoke("non-string style backfilled", '{"userZoneStyle":42}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "droid", "non-string userZoneStyle was not backfilled to droid");
	assert(config.userZoneStyle === "droid", "non-string userZoneStyle did not normalize to droid");
});

await runStyleResolverSmoke();
await runBoxEditorSmoke();
await runFixedZoneSmoke();
console.log("user-zone style smoke ok");
