#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "reasonix-conversation-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareBuild() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "node:fs" {
	export * from "fs";
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
	export const relative: (from: string, to: string) => string;
}
declare module "node:path" {
	export * from "path";
}
declare module "os" {
	export const homedir: () => string;
}
declare module "node:os" {
	export * from "os";
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare const process: any;
`, "utf8");

	const result = spawnSync(process.execPath, [
		tsc,
		"--target", "ES2022",
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--outDir", buildDir,
		"--rootDir", repoRoot,
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		join(repoRoot, "config.ts"),
		join(repoRoot, "user-zone", "designs.ts"),
		join(repoRoot, "presentation", "designs.ts"),
		join(repoRoot, "presentation", "state.ts"),
		join(repoRoot, "messages", "user-prefix.ts"),
		join(repoRoot, "messages", "assistant-prefix.ts"),
		join(repoRoot, "tool-tags", "common.ts"),
		join(repoRoot, "tool-tags", "quick-edit.ts"),
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`tsc failed\n${result.stdout}\n${result.stderr}`);
}

async function importBuilt(relativePath) {
	return import(`${pathToFileURL(join(buildDir, relativePath)).href}?module=${importCounter++}`);
}

async function loadConfigCase(name, initialConfig) {
	const home = join(workDir, name.replaceAll(" ", "-"));
	const configDir = join(home, ".pi", "agent");
	const configPath = join(configDir, "pi-droid-styling.json");
	mkdirSync(configDir, { recursive: true });
	if (initialConfig !== undefined) writeFileSync(configPath, `${JSON.stringify(initialConfig)}\n`, "utf8");

	process.env.HOME = home;
	const moduleUrl = `${pathToFileURL(join(buildDir, "config.js")).href}?case=${importCounter++}`;
	const { loadConfig } = await import(moduleUrl);
	const config = loadConfig();
	assert(existsSync(configPath), `${name}: config file was not scaffolded`);
	return { config, raw: JSON.parse(readFileSync(configPath, "utf8")) };
}

prepareBuild();

const scaffolded = await loadConfigCase("scaffold", undefined);
assert(scaffolded.config.presentationStyle === "droid", "presentationStyle should default to droid");
assert(scaffolded.raw.presentationStyle === "droid", "presentationStyle should be scaffolded as droid");

const reasonix = await loadConfigCase("reasonix", { presentationStyle: "reasonix" });
assert(reasonix.config.presentationStyle === "reasonix", "reasonix presentationStyle should be preserved");

const invalid = await loadConfigCase("invalid", { presentationStyle: "neon" });
assert(invalid.config.presentationStyle === "droid", "invalid presentationStyle should fall back to droid");
assert(invalid.raw.presentationStyle === "neon", "unknown string should remain on disk for forward compatibility");

const { initTheme, UserMessageComponent, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");
const { setPresentationStyle } = await import(pathToFileURL(join(buildDir, "presentation", "state.js")).href);
const { installUserMessagePrefix } = await importBuilt("messages/user-prefix.js");
const { installAssistantMessagePrefix } = await importBuilt("messages/assistant-prefix.js");

const fgCalls = [];
const activeTheme = {
	fg: (color, text) => {
		fgCalls.push(color);
		return `\x1b[38;5;7m${text}\x1b[39m`;
	},
	bg: (_color, text) => `\x1b[48;5;8m${text}\x1b[49m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	getBgAnsi: () => "\x1b[48;2;32;35;42m",
	getFgAnsi: () => "\x1b[38;2;180;180;180m",
	getColorMode: () => "256",
};
const stripAnsi = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

setPresentationStyle("reasonix");
installUserMessagePrefix(activeTheme);
installAssistantMessagePrefix(activeTheme);
const userLines = new UserMessageComponent("hello\nworld").render(40).map(stripAnsi);
assert(userLines[0]?.includes("❯  hello"), "reasonix user should start directly with a compact prompt marker");
assert(!userLines.some((line) => line.includes("─".repeat(40))), "reasonix user should not render a full-width divider");
assert(!new UserMessageComponent("hello").render(40).some((line) => line.includes("\x1b[48;")), "reasonix user should not render a background card");

const assistantMessage = { role: "assistant", content: [{ type: "text", text: "answer\nmore" }] };
const assistantLines = new AssistantMessageComponent(assistantMessage).render(40).map(stripAnsi);
assert(assistantLines[0]?.includes("•  answer"), "reasonix assistant should start directly with a compact role marker");
assert(!assistantLines.some((line) => line.includes("─".repeat(40))), "reasonix assistant should not render a full-width divider");
assert(fgCalls.includes("accent"), "reasonix prefix should use the active theme accent token");

setPresentationStyle("droid");
const droidUserRaw = new UserMessageComponent("hello").render(40);
const droidUser = droidUserRaw.map(stripAnsi);
assert(droidUserRaw.some((line) => line.includes("\x1b[48;")), "droid user should retain its background card");
assert(droidUser.some((line) => line.includes("─".repeat(40))), "droid user should retain its divider");
const droidAssistant = new AssistantMessageComponent(assistantMessage).render(40).map(stripAnsi);
assert(droidAssistant.some((line) => line.includes("─".repeat(40))), "droid assistant should retain its divider");

const { renderCompactBoxedToolCall, renderCompactBoxedFooter, renderBoxedToolResult } = await importBuilt("tool-tags/common.js");
const { installQuickEditRenderer } = await importBuilt("tool-tags/quick-edit.js");

setPresentationStyle("reasonix");
const toolState = {};
renderCompactBoxedFooter(activeTheme, { content: [{ type: "text", text: "updated file" }] }, { state: toolState });
const compactTool = renderCompactBoxedToolCall(activeTheme, "Read", "src/config.ts", { state: toolState });
const compactToolLines = compactTool.render(80).map(stripAnsi);
assert(compactToolLines.length === 1, "reasonix collapsed tool should render one summary row");
assert(compactToolLines[0]?.includes("Read") && compactToolLines[0]?.includes("src/config.ts"), "reasonix summary should retain tool name and subject");
assert(!compactToolLines[0]?.includes("┌"), "reasonix collapsed tool should not render an outer box");

const expandedTool = renderBoxedToolResult(activeTheme, () => ["full detail line one", "full detail line two"], { footerLines: ["0.20s"] });
const expandedToolLines = expandedTool.render(80).map(stripAnsi);
assert(expandedToolLines.some((line) => line.includes("full detail line one")), "reasonix expanded tool should retain full body");
assert(expandedToolLines.some((line) => line.includes("full detail line two")), "reasonix expanded tool should retain all body lines");
assert(!expandedToolLines.some((line) => line.includes("┌") || line.includes("│")), "reasonix expanded tool should use indentation without a box or rail");
assert(expandedToolLines.every((line) => line.startsWith("  ")), "reasonix expanded tool body should be indented");
assert(expandedTool.render(24).every((line) => stripAnsi(line).length <= 24), "reasonix expanded body should fit narrow terminals");

class FakeToolExecutionComponent {
	constructor() { this.toolName = "quick_edit"; }
	getResultRenderer() { return () => ({ render: () => [], invalidate() {} }); }
	getCallRenderer() { return () => ({ render: () => [], invalidate() {} }); }
}
installQuickEditRenderer(FakeToolExecutionComponent);
const quickEdit = new FakeToolExecutionComponent();
const quickEditRenderer = quickEdit.getResultRenderer();
const quickEditCallRenderer = quickEdit.getCallRenderer();
const quickEditState = {};
const quickEditResult = { content: [{ type: "text", text: "── diff ──\n:1\n- old\n+ new\n---" }] };
const quickEditCall = quickEditCallRenderer({ path: "src/demo.ts" }, activeTheme, { state: quickEditState, cwd: process.cwd() });
const collapsedQuickEdit = quickEditRenderer(quickEditResult, { expanded: false }, activeTheme, { state: quickEditState, args: { path: "src/demo.ts" }, cwd: process.cwd() });
assert(collapsedQuickEdit.render(80).length === 0, "reasonix quick-edit collapsed result should fold into the call row");
const collapsedQuickEditLines = quickEditCall.render(80).map(stripAnsi);
assert(collapsedQuickEditLines.length === 1, "reasonix quick-edit collapsed view should stay one row");
assert(collapsedQuickEditLines[0]?.includes("+1") && collapsedQuickEditLines[0]?.includes("-1"), "reasonix quick-edit collapsed row should retain diff stats");

const quickEditErrorState = {};
const quickEditErrorCall = quickEditCallRenderer({ path: "src/demo.ts" }, activeTheme, { state: quickEditErrorState, cwd: process.cwd() });
const collapsedQuickEditError = quickEditRenderer(
	{ isError: true, content: [{ type: "text", text: "edit failed" }] },
	{ expanded: false },
	activeTheme,
	{ state: quickEditErrorState, isError: true, args: { path: "src/demo.ts" }, cwd: process.cwd() },
);
assert(collapsedQuickEditError.render(80).length === 0, "reasonix quick-edit error should fold into the call row");
const quickEditErrorLine = stripAnsi(quickEditErrorCall.render(80)[0] ?? "");
assert(quickEditErrorLine.includes("✗") && quickEditErrorLine.includes("edit failed"), "reasonix quick-edit collapsed error should retain status and message");

const quickEditOutput = quickEditRenderer(
	quickEditResult,
	{ expanded: true },
	activeTheme,
	{ state: quickEditState, args: { path: "src/demo.ts" }, cwd: process.cwd() },
);
const quickEditLines = quickEditOutput.render(80).map(stripAnsi);
assert(quickEditLines.some((line) => line.includes("old")), "reasonix quick-edit expanded view should retain removals");
assert(quickEditLines.some((line) => line.includes("new")), "reasonix quick-edit expanded view should retain additions");
assert(quickEditLines.every((line) => line.startsWith("  ") && !line.startsWith("│ ")), "reasonix quick-edit should use indentation without an outer rail");

setPresentationStyle("droid");
const droidToolLines = renderCompactBoxedToolCall(activeTheme, "Read", "src/config.ts", { state: toolState }).render(80).map(stripAnsi);
assert(droidToolLines.some((line) => line.includes("┌")), "droid tool presentation should retain its outer box");

console.log("reasonix conversation presentation smoke ok");
