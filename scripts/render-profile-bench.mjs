#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

process.env.PI_DROID_PROFILE = process.env.PI_DROID_PROFILE || "1";
process.env.PI_DROID_PROFILE_INTERVAL_MS = process.env.PI_DROID_PROFILE_INTERVAL_MS || "60000";
process.env.PI_DROID_PROFILE_OUT = process.env.PI_DROID_PROFILE_OUT || join(tmpdir(), `pi-droid-render-profile-${Date.now()}.jsonl`);

const repoRoot = process.cwd();
const buildDir = join(repoRoot, ".pi", "profile-bench-build");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iterations = Math.max(1, Number(process.env.PI_DROID_PROFILE_BENCH_ITERATIONS || 120));
const rootLineCount = Math.max(10, Number(process.env.PI_DROID_PROFILE_BENCH_ROOT_LINES || 180));

function collectTsFiles(dir) {
	const ignored = new Set([".git", ".memory", ".pi", "node_modules"]);
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (ignored.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(path));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(relative(repoRoot, path));
		}
	}
	return files;
}

function compileSources() {
	rmSync(buildDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run profile:render");
	const files = collectTsFiles(repoRoot);
	const result = spawnSync(process.execPath, [
		tsc,
		"--outDir", buildDir,
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--target", "ES2022",
		"--skipLibCheck",
		"--allowSyntheticDefaultImports",
		"--esModuleInterop",
		"--noImplicitAny", "false",
		...files,
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
}

async function importBuilt(relativePath) {
	return import(pathToFileURL(join(buildDir, relativePath)).href);
}

compileSources();

const [profiler, sidebar, split, gitStatus, renderThrottle, assistantDebounce, toolDebounce] = await Promise.all([
	importBuilt("performance/profiler.js"),
	importBuilt("fixed-zone/sidebar.js"),
	importBuilt("fixed-zone/terminal-split.js"),
	importBuilt("core/git-status.js"),
	importBuilt("performance/render-throttle.js"),
	importBuilt("performance/debounce-update.js"),
	importBuilt("performance/debounce-tool-updates.js"),
]);

const { flushProfile, profileCount, profileSample } = profiler;
const { renderFixedZoneSidebar } = sidebar;
const { TerminalSplitCompositor } = split;
const { createGitBranchFetcher } = gitStatus;
const { installRenderThrottle } = renderThrottle;
const { installAssistantUpdateDebounce } = assistantDebounce;
const { installToolExecutionUpdateDebounce } = toolDebounce;

function makeFiles(count) {
	return Array.from({ length: count }, (_value, index) => ({
		path: `src/module-${index % 12}/component-${index}.ts`,
		insertions: index % 4 === 0 ? index + 3 : undefined,
		deletions: index % 5 === 0 ? index + 1 : undefined,
	}));
}

const sidebarInfo = {
	sessionId: "bench-session-abcdef1234567890",
	sessionName: "Synthetic render profiling bench",
	cwd: repoRoot,
	branch: "feat/fuz-sidebar",
	insertions: 1234,
	deletions: 321,
	modifiedFiles: makeFiles(64),
	piVersion: "bench",
};

profileCount("bench.start");
profileSample("bench.iterations", iterations);

for (let i = 0; i < iterations; i++) {
	renderFixedZoneSidebar(sidebarInfo, i % 2 === 0 ? 36 : 30, i % 3 === 0 ? 36 : 28);
}

let rawRows = 36;
let terminalBytes = 0;
const terminal = {
	columns: 140,
	get rows() { return rawRows; },
	set rows(value) { rawRows = value; },
	write(data) {
		terminalBytes += Buffer.byteLength(String(data), "utf8");
	},
};

class BenchRootLineComponent {
	constructor(index) {
		this.index = index;
	}
	render(width) {
		profileCount("bench.root.component.render.calls");
		const safeWidth = Math.max(20, width);
		const prefix = `root ${String(this.index).padStart(4, "0")} `;
		return [`${prefix}${"x".repeat(Math.max(0, safeWidth - prefix.length - 1))}`];
	}
	invalidate() {}
}

const tui = {
	terminal,
	children: Array.from({ length: rootLineCount }, (_value, index) => new BenchRootLineComponent(index)),
	render(width) {
		const lines = [];
		for (const child of this.children) lines.push(...child.render(width));
		return lines;
	},
	requestRender() {
		profileCount("bench.tui.requestRender");
		this.doRender?.();
	},
	doRender() {
		const lines = this.render(this.terminal.columns);
		this.terminal.write(`${lines.join("\n")}\n`);
	},
};

const hiddenRenderables = [
	{
		target: { render: () => [] },
		render: (width) => [
			`status ${"─".repeat(Math.max(0, width - 8))}`,
			`editor ${" ".repeat(Math.max(0, width - 8))}`,
			`footer ${"π".repeat(Math.max(0, Math.min(8, width - 8)))}`,
		],
	},
];

const compositor = new TerminalSplitCompositor(tui, hiddenRenderables, {
	sidebar: {
		enabled: true,
		getInfo: () => sidebarInfo,
	},
});

compositor.install();
for (let i = 0; i < Math.max(10, Math.floor(iterations / 3)); i++) {
	tui.doRender();
	terminal.write(`stream chunk ${i}\n`);
	if (i % 4 === 0) compositor.handleInput("\x1b[<64;10;5M");
	if (i % 9 === 0) {
		terminal.columns = terminal.columns === 140 ? 124 : 140;
		rawRows = rawRows === 36 ? 32 : 36;
		tui.requestRender();
	}
}
compositor.dispose();
profileSample("bench.terminalBytes", terminalBytes);

let throttledDispatches = 0;
const throttledTui = { requestRender: () => { throttledDispatches++; } };
installRenderThrottle(throttledTui, 10);
for (let i = 0; i < 50; i++) throttledTui.requestRender(i % 17 === 0);
await sleep(30);
profileSample("bench.throttledDispatches", throttledDispatches);

class FakeAssistantMessage {
	updates = 0;
	updateContent(message) {
		this.updates++;
		String(message?.text ?? "").toUpperCase();
	}
}
installAssistantUpdateDebounce(FakeAssistantMessage);
const assistantComponent = new FakeAssistantMessage();
for (let i = 0; i < 40; i++) assistantComponent.updateContent({ text: `delta ${i}` });
await sleep(80);
assistantComponent.updateContent({ text: "done", stopReason: "end" });
profileSample("bench.assistantActualUpdates", assistantComponent.updates);

class FakeToolExecution {
	updates = 0;
	ui = { requestRender: () => profileCount("bench.tool.requestRender") };
	updateResult(result, isPartial = false) {
		this.updates++;
		String(result?.output ?? "").slice(0, isPartial ? 100 : 200);
	}
}
installToolExecutionUpdateDebounce(FakeToolExecution);
const toolComponent = new FakeToolExecution();
for (let i = 0; i < 40; i++) toolComponent.updateResult({ output: `partial ${i}\n${"y".repeat(200)}` }, true);
await sleep(100);
toolComponent.updateResult({ output: "final" }, false);
profileSample("bench.toolActualUpdates", toolComponent.updates);

const fetchBranch = createGitBranchFetcher(repoRoot, () => profileCount("bench.git.onUpdate"));
fetchBranch();
await sleep(1200);
for (let i = 0; i < 20; i++) fetchBranch();

profileCount("bench.done");
flushProfile("bench");

rmSync(buildDir, { recursive: true, force: true });

console.log(JSON.stringify({
	profileOut: process.env.PI_DROID_PROFILE_OUT,
	iterations,
	rootLineCount,
	terminalBytes,
	throttledDispatches,
}, null, 2));
