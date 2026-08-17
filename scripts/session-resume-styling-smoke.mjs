#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "session-resume-styling-smoke");
const sourceBuildDir = join(workDir, "compiled");
const runtimeADir = join(workDir, "runtime-a");
const runtimeBDir = join(workDir, "runtime-b");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function writeNodeStubs() {
	writeFileSync(stubPath, `declare module "fs" {
	export const appendFileSync: any;
	export const existsSync: any;
	export const readFileSync: any;
	export const readdirSync: any;
}
declare module "node:fs" {
	export const appendFileSync: any;
	export const existsSync: any;
	export const readFileSync: any;
	export const readdirSync: any;
}
declare module "node:buffer" {
	export const Buffer: any;
}
declare module "node:os" {
	export const homedir: () => string;
}
declare module "node:path" {
	export const dirname: (...parts: string[]) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare module "node:perf_hooks" {
	export const monitorEventLoopDelay: any;
	export const performance: any;
}
declare const process: any;
`, "utf8");
}

function prepareBuild() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(sourceBuildDir, { recursive: true });
	writeNodeStubs();

	const result = spawnSync(process.execPath, [
		tsc,
		"--target", "ES2022",
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--outDir", sourceBuildDir,
		"--rootDir", repoRoot,
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		join(repoRoot, "presentation", "designs.ts"),
		join(repoRoot, "presentation", "reasonix-layout.ts"),
		join(repoRoot, "presentation", "state.ts"),
		join(repoRoot, "performance", "profiler.ts"),
		join(repoRoot, "render-budget.ts"),
		join(repoRoot, "theme", "ansi.ts"),
		join(repoRoot, "theme", "theme-extras.ts"),
		join(repoRoot, "tool-tags", "compact-tool-spacing.ts"),
		join(repoRoot, "tool-tags", "resume-tool-refresh.ts"),
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`tsc failed\n${result.stdout}\n${result.stderr}`);

	for (const runtimeDir of [runtimeADir, runtimeBDir]) {
		cpSync(sourceBuildDir, runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "package.json"), '{"type":"module"}\n', "utf8");
	}
}

async function importRuntime(runtimeDir, relativePath) {
	return import(pathToFileURL(join(runtimeDir, relativePath)).href);
}

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};
const proto = ToolExecutionComponent.prototype;
const originalRender = proto.render;
const globalPatchFlag = "__compactToolSpacingPatched__";
const originalGlobalPatchFlag = globalThis[globalPatchFlag];

try {
	prepareBuild();
	proto.render = function baseResumeToolRender() {
		return ["┌box", "│ body", "└box"];
	};
	delete globalThis[globalPatchFlag];

	const runtimeAState = await importRuntime(runtimeADir, "presentation/state.js");
	const runtimeACompact = await importRuntime(runtimeADir, "tool-tags/compact-tool-spacing.js");
	runtimeAState.setPresentationStyle("droid");
	runtimeACompact.setToolSpacingTheme(theme);
	runtimeACompact.installCompactToolSpacing(ToolExecutionComponent);
	const droidLines = proto.render.call({ expanded: false }, 40);
	assert(droidLines.length === 3 && droidLines[0] === "┌box", "runtime A should retain the boxed Droid tool");

	const runtimeBState = await importRuntime(runtimeBDir, "presentation/state.js");
	const runtimeBCompact = await importRuntime(runtimeBDir, "tool-tags/compact-tool-spacing.js");
	runtimeBState.setPresentationStyle("reasonix");
	runtimeBCompact.setToolSpacingTheme(theme);
	runtimeBCompact.installCompactToolSpacing(ToolExecutionComponent);
	const resumedLines = proto.render.call({ expanded: false }, 40);
	assert(resumedLines[0] === "┌box", "runtime B should preserve the tool title");
	assert(resumedLines.length === 4 && resumedLines.at(-1) === "", "runtime B should take ownership and apply Reasonix trailing spacing");

	const restoredTool = {
		toolName: "read",
		toolDefinition: { renderCall: () => "stale" },
		refreshCount: 0,
		updateDisplay() { this.refreshCount++; },
	};
	const currentDefinition = { renderCall: () => "current" };
	const hiddenRestoredTool = {
		toolName: "bash",
		toolDefinition: { renderCall: () => "stale" },
		refreshCount: 0,
		updateDisplay() { this.refreshCount++; },
	};
	const virtualizedState = Symbol.for("pi-droid-styling.virtualized-chat.state");
	class FakeInteractiveMode {
		session = { getToolDefinition: (name) => name === "read" || name === "bash" ? currentDefinition : undefined };
		chatContainer = {
			children: [restoredTool],
			[virtualizedState]: { hiddenChildren: [hiddenRestoredTool] },
		};
		ui = { requestRender() {} };
		renderCurrentSessionState() {}
	}
	const runtimeBRefresh = await importRuntime(runtimeBDir, "tool-tags/resume-tool-refresh.js");
	runtimeBRefresh.installResumeToolRefresh(FakeInteractiveMode);
	const mode = new FakeInteractiveMode();
	mode.renderCurrentSessionState();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(restoredTool.toolDefinition === currentDefinition, "resume refresh should rebind the current tool definition");
	assert(restoredTool.refreshCount === 1, "resume refresh should rebuild each restored tool renderer once");
	assert(hiddenRestoredTool.toolDefinition === currentDefinition, "resume refresh should rebind virtualized hidden tools");
	assert(hiddenRestoredTool.refreshCount === 1, "resume refresh should rebuild virtualized hidden tools once");

	console.log("session resume styling smoke: ok");
} finally {
	proto.render = originalRender;
	if (originalGlobalPatchFlag === undefined) delete globalThis[globalPatchFlag];
	else globalThis[globalPatchFlag] = originalGlobalPatchFlag;
}
