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

	const one = (lines, width = 80) => stripAnsi(stylePiTasksWidgetLines(lines, noTheme, width, "compact").join("\n"));

	// active task with upstream no-token metrics: keep time, strip active ellipsis
	let r = one([
		"● 3 tasks (1 done, 1 in progress, 1 open)",
		"✔ #1 Scan repo",
		"✳ #2 Refactor editor… (4s)",
		"◻ #3 Add tests",
	]);
	assert(r.includes("● Tasks › [2] Refactor editor · 4s"), `active time, got: ${r}`);
	assert(/ \(1\/3 done · 1 running\)$/.test(r), `counts (1/3 done · 1 running), got: ${r}`);
	assert(!r.includes("… · 4s"), `active ellipsis should be stripped, got: ${r}`);
	console.log("compact: active time ok");

	// all completed uses header counts
	r = one([
		"● 2 tasks (2 done)",
		"✔ #1 Scan repo",
		"✔ #2 Refactor editor",
	]);
	assert(/● Tasks done \(2\/2 done\)$/.test(r), `all done, got: ${r}`);
	console.log("compact: all done ok");

	// idle/no rows fallback
	r = one(["● Tasks"]);
	assert(r.trim() === "● Tasks · idle", `idle, got: ${r}`);
	console.log("compact: idle ok");

	// blocked indicator is based on visible blocked rows
	r = one([
		"● 3 tasks (1 done, 1 in progress, 1 open)",
		"✔ #1 Scan repo",
		"✳ #2 Write tests… (5s) › blocked by #1",
		"◻ #3 Add docs",
	]);
	assert(r.includes("1 blocked"), `blocked indicator, got: ${r}`);
	assert(/ \(1\/3 done · 1 running\)/.test(r), `counts with blocked, got: ${r}`);
	console.log("compact: blocked ok");

	// header counts win over visible rows when overflow hides tasks
	r = one([
		"● 5 tasks (4 done, 1 in progress)",
		"✳ #1 Scan repo… (9s)",
		"✔ #2 Refactor editor",
		"… and 3 more",
	]);
	assert(/ \(4\/5 done · 1 running\)$/.test(r), `overflow uses header counts (4/5 done · 1 running), got: ${r}`);
	console.log("compact: overflow header counts ok");

	// if header says work is running but the current row is hidden, do not report idle
	r = one([
		"● 5 tasks (4 done, 1 in progress)",
		"✔ #1 Completed visible",
		"✔ #2 Also completed",
		"… and 3 more",
	]);
	assert(/● Tasks idle \(4\/5 done · 1 running\)$/.test(r), `hidden running should not look idle, got: ${r}`);
	console.log("compact: hidden running summary ok");

	// active spinner is the current task, not a stale non-active in-progress row
	r = one([
		"● 3 tasks (0 done, 2 in progress, 1 open)",
		"◼ #2 Waiting on IO",
		"✳ #3 Actually running… (7s)",
		"◻ #4 Add docs",
	]);
	assert(r.includes("› [3] Actually running · 7s"), `active should win over running, got: ${r}`);
	assert(!r.includes("Waiting on IO"), `stale running picked, got: ${r}`);
	console.log("compact: active selection ok");

	// multiple non-active in-progress rows rotate every 3 seconds
	const realNow = Date.now;
	try {
		const rotating = [
			"● 3 tasks (0 done, 2 in progress, 1 open)",
			"◼ #2 First running",
			"◼ #3 Second running",
			"◻ #4 Add docs",
		];
		Date.now = () => 0;
		r = one(rotating);
		assert(r.includes("› [2] First running"), `cycle bucket 0, got: ${r}`);
		Date.now = () => 3000;
		r = one(rotating);
		assert(r.includes("› [3] Second running"), `cycle bucket 1, got: ${r}`);
		Date.now = () => 6000;
		r = one(rotating);
		assert(r.includes("› [2] First running"), `cycle bucket 2 wraps, got: ${r}`);

		Date.now = () => 3000;
		r = one([
			"● 3 tasks (0 done, 2 in progress, 1 open)",
			"◼ #2 Stale running",
			"✳ #3 Active spinner… (7s)",
			"◻ #4 Add docs",
		]);
		assert(r.includes("› [3] Active spinner · 7s"), `active should still win over non-active running, got: ${r}`);
		assert(!r.includes("Stale running"), `non-active running should not beat active, got: ${r}`);
	} finally {
		Date.now = realNow;
	}
	console.log("compact: 3s current-task cycle ok");

	// compact drops token arrows, keeps time dim segment text (real parenthesized format)
	r = one([
		"● 3 tasks (1 done, 1 in progress, 1 open)",
		"✔ #1 Scan repo",
		"✳ #2 Refactor editor… (2m 49s · ↑ 4.1k ↓ 1.2k)",
		"◻ #3 Add tests",
	]);
	assert(r.includes("› [2] Refactor editor · 2m 49s"), `keep time, got: ${r}`);
	assert(!/↑|↓|4\.1k|1\.2k/.test(r), `drop token arrows, got: ${r}`);
	console.log("compact: parenthesized metrics ok");

	// compact also keeps time from older/trailing metric shape, but only when token segment is metric-like
	r = one([
		"● 3 tasks (1 done, 1 in progress, 1 open)",
		"✔ #1 Scan repo",
		"✳ #2 Refactor editor · 4s · 0.8k tok",
		"◻ #3 Add tests",
	]);
	assert(r.includes("› [2] Refactor editor · 4s"), `keep trailing time, got: ${r}`);
	assert(!/tok|0\.8k/.test(r), `drop trailing token, got: ${r}`);
	console.log("compact: trailing metrics ok");

	// ordinary parentheses in task names are preserved; only the final metric suffix is stripped
	r = one([
		"● 2 tasks (0 done, 1 in progress, 1 open)",
		"✳ #2 Handle files (3 cases)… (4s)",
		"◻ #3 Add tests",
	]);
	assert(r.includes("› [2] Handle files (3 cases) · 4s"), `ordinary parentheses preserved, got: ${r}`);
	console.log("compact: ordinary parentheses ok");

	// real width is respected: no min-width 100 lie
	const longName = "✳ #2 " + "A".repeat(120) + "… (4s)";
	r = one([
		"● 3 tasks (1 done, 1 in progress, 1 open)",
		"✔ #1 Scan repo",
		longName,
		"◻ #3 Add tests",
	], 60);
	assert(r.includes("(1/3 done · 1 running)"), `long name keeps counts, got: ${r}`);
	assert(stripAnsi(r).length <= 60, `long name respects width=60, got len ${stripAnsi(r).length}: ${r}`);
	assert(r.includes("›"), `long name shows current marker, got: ${r}`);
	console.log("compact: real-width truncation ok");

	// default style still multi-line and drops active token metrics only
	const multi = stylePiTasksWidgetLines([
		"● 2 tasks (0 done, 1 in progress, 1 open)",
		"✳ #1 Handle files (3 cases)… (4s · ↑ 800 ↓ 300)",
	], noTheme, 80, "default").map(stripAnsi);
	assert(Array.isArray(multi) && multi.length === 2, `default multi-line, got ${multi.length} lines`);
	assert(multi[1].includes("Handle files (3 cases)… · 4s"), `default keeps time and name parens, got: ${multi[1]}`);
	assert(!/↑|↓|800|300/.test(multi[1]), `default drops token metrics, got: ${multi[1]}`);
	console.log("compact: default style multi-line ok");
}

async function runCompactCacheSmoke() {
	const widget = await importBuilt("widgets/pi-tasks-widget.js");
	const { installPiTasksWidgetStyling } = widget;

	function createWrappedComponent(lines) {
		let storedContent;
		const sessionUi = {
			theme: noTheme,
			terminal: { columns: 80 },
			setWidget(_key, content) { storedContent = content; },
		};
		const dispose = installPiTasksWidgetStyling(sessionUi, "compact");
		sessionUi.setWidget("tasks", () => ({ render: () => lines }), { placement: "aboveEditor" });
		const component = storedContent({ terminal: { columns: 80 } }, noTheme);
		return { component, dispose };
	}

	const realNow = Date.now;
	try {
		Date.now = () => 0;
		let wrapped = createWrappedComponent([
			"● 2 tasks (0 done, 1 in progress, 1 open)",
			"✳ #1 Single active… (4s)",
			"◻ #2 Add docs",
		]);
		const singleFirst = wrapped.component.render();
		Date.now = () => 3000;
		const singleSecond = wrapped.component.render();
		assert(singleSecond === singleFirst, "single running task should not invalidate cache every 3s");
		wrapped.dispose?.();

		Date.now = () => 0;
		wrapped = createWrappedComponent([
			"● 3 tasks (0 done, 2 in progress, 1 open)",
			"◼ #1 First running",
			"◼ #2 Second running",
			"◻ #3 Add docs",
		]);
		const multiFirst = stripAnsi(wrapped.component.render()[0]);
		Date.now = () => 3000;
		const multiSecond = stripAnsi(wrapped.component.render()[0]);
		assert(multiFirst !== multiSecond, `multiple running tasks should invalidate cache each cycle, got ${multiFirst}`);
		assert(multiFirst.includes("[1] First running") && multiSecond.includes("[2] Second running"), `cycle cache output wrong: ${multiFirst} -> ${multiSecond}`);
		wrapped.dispose?.();
	} finally {
		Date.now = realNow;
	}
	console.log("compact: conditional cycle cache ok");
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
	await runCompactCacheSmoke();
	await runConfigSmoke();
	console.log("tasks-widget-compact smoke ok");
	rmSync(workDir, { recursive: true, force: true });
}

main().catch((err) => {
	process.stderr.write(`${err.stack || err}\n`);
	process.exit(1);
});