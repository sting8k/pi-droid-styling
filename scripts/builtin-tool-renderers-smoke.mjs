#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
// Unique per run: concurrent smoke runs (or parallel agent sessions) must not
// race each other on a shared fixed build dir.
const workDir = mkdtempSync(join(repoRoot, ".pi", "builtin-tool-renderers-smoke-"));
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "@earendil-works/pi-coding-agent" {
	export type AgentToolResult<T> = any;
	export type ToolRenderResultOptions = any;
	export type ExtensionAPI = any;
	export type Theme = any;
	export const getLanguageFromPath: any;
	export const highlightCode: any;
	export const createEditToolDefinition: any;
	export const getAgentDir: any;
}
declare module "@earendil-works/pi-tui" {
	export type Component = any;
	export const Text: any;
	export const truncateToWidth: any;
	export const visibleWidth: any;
	export const wrapTextWithAnsi: any;
}
declare module "node:fs";
declare module "node:path";
declare module "node:url";
declare module "node:os";
declare module "fs";
declare module "path";
declare module "os";
declare const process: any;
`, "utf8");

	// Runtime stubs so the compiled modules do not load the real SDK.
	const stubAgentPkgDir = join(buildDir, "node_modules", "@earendil-works", "pi-coding-agent");
	mkdirSync(stubAgentPkgDir, { recursive: true });
	writeFileSync(join(stubAgentPkgDir, "package.json"), "{\"name\":\"@earendil-works/pi-coding-agent\",\"version\":\"0.0.0-stub\",\"type\":\"module\",\"main\":\"index.js\"}\n", "utf8");
	writeFileSync(join(stubAgentPkgDir, "index.js"), `export const getLanguageFromPath = () => undefined;
export const highlightCode = () => [];
export const createEditToolDefinition = () => ({ name: "edit", label: "edit", description: "stub", parameters: {} });
export const getAgentDir = () => "/nonexistent-agent-dir";
`, "utf8");

	const stubTuiPkgDir = join(buildDir, "node_modules", "@earendil-works", "pi-tui");
	mkdirSync(stubTuiPkgDir, { recursive: true });
	writeFileSync(join(stubTuiPkgDir, "package.json"), "{\"name\":\"@earendil-works/pi-tui\",\"version\":\"0.0.0-stub\",\"type\":\"module\",\"main\":\"index.js\"}\n", "utf8");
	writeFileSync(join(stubTuiPkgDir, "index.js"), `export class Text {
	constructor() {}
	invalidate() {}
	render() { return []; }
}
export const truncateToWidth = (text) => text;
export const visibleWidth = (text) => String(text ?? "").length;
export const wrapTextWithAnsi = (text) => [String(text ?? "")];
`, "utf8");
}

function compileBuiltinToolRenderers() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:builtin-tool-renderers");
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
		"tool-tags/builtin-tool-renderers.ts",
		"tool-tags/elapsed.ts",
		"tool-tags/common.ts",
		"tool-tags/register-tool-call-tags.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc builtin tool renderers ok");
}

function makeFakeComponentClass() {
	let baseCallCalls = 0;
	let baseResultCalls = 0;
	let baseShellCalls = 0;
	class FakeToolExecutionComponent {
		getCallRenderer() {
			baseCallCalls++;
			return this.toolDefinition?.renderCall;
		}
		getResultRenderer() {
			baseResultCalls++;
			return this.toolDefinition?.renderResult;
		}
		getRenderShell() {
			baseShellCalls++;
			return this.toolDefinition?.renderShell;
		}
	}
	return { FakeToolExecutionComponent, baseCallCount: () => baseCallCalls, baseResultCount: () => baseResultCalls, baseShellCount: () => baseShellCalls };
}

async function runBuiltinToolRenderersSmoke() {
	const buildToolTags = (name) => pathToFileURL(join(buildDir, "tool-tags", name)).href;
	const renderers = await import(buildToolTags("builtin-tool-renderers.js"));
	const elapsed = await import(buildToolTags("elapsed.js"));
	const common = await import(buildToolTags("common.js"));

	const theme = { fg: (_color, text) => text };

	const toolModules = {
		read: await import(buildToolTags("read.js")),
		write: await import(buildToolTags("write.js")),
		edit: await import(buildToolTags("edit.js")),
		ls: await import(buildToolTags("ls.js")),
		find: await import(buildToolTags("find.js")),
		grep: await import(buildToolTags("grep.js")),
		bash: await import(buildToolTags("bash.js")),
	};

	// --- 1. Patch resolution ---
	const { FakeToolExecutionComponent, baseCallCount, baseResultCount, baseShellCount } = makeFakeComponentClass();
	renderers.installBuiltinToolRenderers(FakeToolExecutionComponent);

	const expected = {
		read: ["renderReadCall", "renderReadResult"],
		write: ["renderWriteCall", "renderWriteResult"],
		edit: ["renderEditCall", "renderEditResult"],
		ls: ["renderLsCall", "renderLsResult"],
		find: ["renderFindCall", "renderFindResult"],
		grep: ["renderGrepCall", "renderGrepResult"],
		bash: ["renderBashCall", "renderBashResult"],
	};

	for (const [toolName, [callName, resultName]] of Object.entries(expected)) {
		const instance = Object.assign(new FakeToolExecutionComponent(), { toolName, toolDefinition: {} });
		const callRenderer = instance.getCallRenderer();
		const resultRenderer = instance.getResultRenderer();
		assert(typeof callRenderer === "function", `${toolName}: patched getCallRenderer did not return a function`);
		assert(callRenderer === toolModules[toolName][callName], `${toolName}: call renderer is not the droid ${callName}`);
		assert(typeof resultRenderer === "function", `${toolName}: patched getResultRenderer did not return a function`);
		assert(resultRenderer === toolModules[toolName][resultName], `${toolName}: result renderer is not the droid ${resultName}`);
		assert(instance.getRenderShell() === "default", `${toolName}: getRenderShell did not return "default"`);
	}

	// Unknown names fall through to the base methods.
	const unknownInstance = Object.assign(new FakeToolExecutionComponent(), { toolName: "other_tool", toolDefinition: { renderShell: "self" } });
	assert(unknownInstance.getCallRenderer() === undefined, "unknown tool name did not fall through to base getCallRenderer");
	assert(unknownInstance.getResultRenderer() === undefined, "unknown tool name did not fall through to base getResultRenderer");
	assert(unknownInstance.getRenderShell() === "self", "unknown tool name did not fall through to base getRenderShell");
	assert(baseCallCount() === 1 && baseResultCount() === 1 && baseShellCount() === 1, "base methods were not called exactly once for the unknown tool name");

	// Double install must not double-wrap (Symbol.for guards).
	const callRendererFn = FakeToolExecutionComponent.prototype.getCallRenderer;
	const resultRendererFn = FakeToolExecutionComponent.prototype.getResultRenderer;
	const renderShellFn = FakeToolExecutionComponent.prototype.getRenderShell;
	renderers.installBuiltinToolRenderers(FakeToolExecutionComponent);
	assert(FakeToolExecutionComponent.prototype.getCallRenderer === callRendererFn, "double install re-wrapped getCallRenderer");
	assert(FakeToolExecutionComponent.prototype.getResultRenderer === resultRendererFn, "double install re-wrapped getResultRenderer");
	assert(FakeToolExecutionComponent.prototype.getRenderShell === renderShellFn, "double install re-wrapped getRenderShell");

	// --- 2. Timing resolution ---
	// Recorded start/end events resolve by toolCallId.
	elapsed.recordToolCallTimingStart("t1");
	elapsed.recordToolCallTimingEnd("t1");
	const recorded = elapsed.resolveToolCallElapsedMs({ toolCallId: "t1" }, undefined);
	assert(typeof recorded === "number" && recorded >= 0, "recorded start/end did not resolve elapsed by toolCallId");

	// Frozen state wins over later records.
	elapsed.recordToolCallTimingStart("t2");
	elapsed.recordToolCallTimingEnd("t2");
	const frozenState = { __droidElapsedMs: 999 };
	assert(elapsed.resolveToolCallElapsedMs({ state: frozenState, toolCallId: "t2" }, undefined) === 999, "frozen state value did not win over event records");

	// result.details.__elapsedMs fallback when no record exists.
	assert(elapsed.resolveToolCallElapsedMs({ toolCallId: "t3" }, { details: { __elapsedMs: 1234 } }) === 1234, "details.__elapsedMs fallback did not resolve");

	// No source at all → footer wall time shows "--".
	const footer = common.formatBoxedFooterFromValues(theme, undefined, "output");
	assert(footer.includes("--"), "footer did not render \"--\" when no elapsed source exists");
	const footerWithValue = common.formatBoxedFooterFromValues(theme, 1500, "output");
	assert(!footerWithValue.includes("--") && footerWithValue.includes("1.50s"), "footer did not render the resolved elapsed value");

	// --- 3. registerToolCallTags registers ONLY edit ---
	const { registerToolCallTags } = await import(buildToolTags("register-tool-call-tags.js"));
	const registeredNames = [];
	const fakePi = { registerTool(definition) { registeredNames.push(definition?.name); } };
	await registerToolCallTags(fakePi);
	assert(JSON.stringify(registeredNames) === JSON.stringify(["edit"]), `registerToolCallTags registered ${JSON.stringify(registeredNames)} instead of ["edit"]`);

	console.log("builtin tool renderers smoke ok (7-name resolution, timing precedence, edit-only registration)");
}

prepareWorkDir();
try {
	compileBuiltinToolRenderers();
	await runBuiltinToolRenderersSmoke();
} finally {
	// Keep the work dir for post-mortem on failure; clean up on the happy path only.
	if (process.exitCode === undefined || process.exitCode === 0) {
		rmSync(workDir, { recursive: true, force: true });
	}
}
