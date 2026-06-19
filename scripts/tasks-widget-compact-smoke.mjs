#!/usr/bin/env node
// Smoke test for the compact one-line tasks widget renderer + tasksWidgetStyle config.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "tasks-widget-compact-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function stripAnsi(text) {
	return String(text)
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
}
declare module "node:path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
}
declare module "os" {
	export const homedir: () => string;
}
declare module "node:os" {
	export const homedir: () => string;
}
declare module "node:buffer" {
	export const Buffer: any;
}
declare module "node:perf_hooks" {
	export const monitorEventLoopDelay: any;
	export const performance: any;
}
declare const process: any;
declare function setInterval(...args: any[]): any;
declare function clearInterval(handle: any): void;
`, "utf8");
}

function compileSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:tasks-widget-compact");
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
		"performance/profiler.ts",
		"render-budget.ts",
		"theme/ansi.ts",
		"widgets/pi-tasks-widget.ts",
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

const noTheme = {};

async function runCompactRendererSmoke() {
	const widget = await importBuilt("widgets/pi-tasks-widget.js");
	const { stylePiTasksWidgetLines } = widget;

	const one = (lines, width = 80) => stripAnsi(stylePiTasksWidgetLines(lines, noTheme, width, "compact").join("\\n"));

	// running task present
	let r = one([
		"● Tasks",
		"✔ #1  Scan repo (3 files)",
		"✳ #2  Refactor box-editor render",
		"◻ #3  Add tests",
	]);
	assert(r.includes("Tasks › Refactor box-editor render"), `running current task, got: ${r}`);
	assert(/\(1\/3\)$/.test(r), `counts (1/3), got: ${r}`);
	console.log("compact: running ok");

	// all completed
	r = one([
		"● Tasks",
		"✔ #1  Scan repo",
		"✔ #2  Refactor editor",
	]);
	assert(/Tasks done  \(2\/2\)$/.test(r), `all done, got: ${r}`);
	console.log("compact: all done ok");

	// idle (no task rows)
	r = one(["● Tasks"]);
	assert(r.trim() === "● Tasks · idle", `idle, got: ${r}`);
	console.log("compact: idle ok");

	// blocked
	r = one([
		"● Tasks",
		"✔ #1  Scan repo",
		"✳ #2  Write tests › blocked by #1",
		"◻ #3  Add docs",
	]);
	assert(r.includes("1 blocked"), `blocked indicator, got: ${r}`);
	assert(/\(1\/3\)/.test(r), `counts with blocked, got: ${r}`);
	console.log("compact: blocked ok");

	// overflow increments total
	r = one([
		"● Tasks",
		"✳ #1  Scan repo",
		"✔ #2  Refactor editor",
		"… and 3 more",
	]);
	assert(/\(1\/5\)$/.test(r), `overflow total (1/5), got: ${r}`);
	console.log("compact: overflow ok");

	// compact drops token arrows, keeps time dim (real parenthesized format)
	r = one([
		"● Tasks",
		"✔ #1  Scan repo (12s · ↑ 1.2k ↓ 0.4k)",
		"✳ #2  Refactor editor (4s · ↑ 0.8k ↓ 0.3k)",
		"◻ #3  Add tests",
	]);
	assert(r.includes("› Refactor editor · 4s"), `keep time, got: ${r}`);
	assert(!/tok|↑|↓/.test(r), `drop token arrows, got: ${r}`);

	// compact also keeps time from the older/trailing metric shape
	r = one([
		"● Tasks",
		"✔ #1  Scan repo · 12s · 1.2k tok",
		"✳ #2  Refactor editor · 4s · 0.8k tok",
		"◻ #3  Add tests",
	]);
	assert(r.includes("› Refactor editor · 4s"), `keep trailing time, got: ${r}`);
	assert(!/tok/.test(r), `drop trailing token, got: ${r}`);
	console.log("compact: metrics time-only ok");

	// compact assumes >=100 cols; a very long name still truncates, counts kept
	const longName = "✳ #2  " + "A".repeat(120);
	r = one([
		"● Tasks",
		"✔ #1  Scan repo",
		longName,
		"◻ #3  Add tests",
	], 60);
	assert(r.includes("(1/3)"), `long name keeps counts, got: ${r}`);
	assert(stripAnsi(r).length <= 100, `long name fits renderWidth=100, got len ${stripAnsi(r).length}`);
	assert(r.includes("›"), `long name shows current marker, got: ${r}`);
	console.log("compact: long-name truncation ok");

	// default style still multi-line
	const multi = stylePiTasksWidgetLines([
		"● Tasks",
		"✳ #1  Scan repo",
	], noTheme, 80, "default");
	assert(Array.isArray(multi) && multi.length === 2, `default multi-line, got ${multi.length} lines`);
	console.log("compact: default style multi-line ok");
}

async function runConfigSmoke() {
	async function loadFresh(homeDir) {
		mkdirSync(homeDir, { recursive: true });
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		const { loadConfig } = await importBuilt("config.js");
		return loadConfig;
	}

	const homeDir = join(workDir, "home-config");
	mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });

	// default is compact
	let loadConfig = await loadFresh(homeDir);
	let config = loadConfig();
	assert(config.tasksWidgetStyle === "compact", `default should be compact, got ${config.tasksWidgetStyle}`);

	// invalid value normalizes to compact
	writeFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), JSON.stringify({ tasksWidgetStyle: "bogus" }) + "\n", "utf8");
	loadConfig = await loadFresh(homeDir);
	config = loadConfig();
	assert(config.tasksWidgetStyle === "compact", `invalid should normalize to compact, got ${config.tasksWidgetStyle}`);

	// explicit default is preserved
	writeFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), JSON.stringify({ tasksWidgetStyle: "default" }) + "\n", "utf8");
	loadConfig = await loadFresh(homeDir);
	config = loadConfig();
	assert(config.tasksWidgetStyle === "default", `explicit default should persist, got ${config.tasksWidgetStyle}`);

	// auto-scaffold on missing config includes tasksWidgetStyle
	const freshHome = join(workDir, "home-fresh");
	mkdirSync(freshHome, { recursive: true });
	loadConfig = await loadFresh(freshHome);
	loadConfig();
	const scaffolded = JSON.parse(readFileSync(join(freshHome, ".pi", "agent", "pi-droid-styling.json"), "utf8"));
	assert(scaffolded.tasksWidgetStyle === "compact", `scaffold should include tasksWidgetStyle=compact, got ${scaffolded.tasksWidgetStyle}`);

	// backfill adds the key to an existing config missing it
	const backfillHome = join(workDir, "home-backfill");
	const backfillPath = join(backfillHome, ".pi", "agent", "pi-droid-styling.json");
	mkdirSync(join(backfillHome, ".pi", "agent"), { recursive: true });
	writeFileSync(backfillPath, JSON.stringify({ alwaysExpanded: true }) + "\n", "utf8");
	loadConfig = await loadFresh(backfillHome);
	loadConfig();
	const backfilled = JSON.parse(readFileSync(backfillPath, "utf8"));
	assert(backfilled.tasksWidgetStyle === "compact", `backfill should add tasksWidgetStyle, got ${backfilled.tasksWidgetStyle}`);
	console.log("config smoke ok");
}

async function main() {
	prepareWorkDir();
	compileSurface();
	await runCompactRendererSmoke();
	await runConfigSmoke();
	console.log("tasks-widget-compact smoke ok");
	rmSync(workDir, { recursive: true, force: true });
}

main().catch((err) => {
	process.stderr.write(`${err.stack || err}\n`);
	process.exit(1);
});