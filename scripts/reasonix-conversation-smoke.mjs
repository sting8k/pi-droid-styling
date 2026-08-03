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
		join(repoRoot, "tool-tags", "compact-tool-spacing.ts"),
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
assert(userLines.at(-1) === "", "reasonix user block should keep one trailing spacer row");

const assistantMessage = { role: "assistant", content: [{ type: "text", text: "answer\nmore" }] };
const assistantLines = new AssistantMessageComponent(assistantMessage).render(40).map(stripAnsi);
assert(assistantLines[0]?.includes("•  answer"), "reasonix assistant should start directly with a compact role marker");
assert(!assistantLines.some((line) => line.includes("─".repeat(40))), "reasonix assistant should not render a full-width divider");
assert(fgCalls.includes("accent"), "reasonix prefix should use the active theme accent token");
assert(assistantLines.at(-1) === "", "reasonix assistant block should keep one trailing spacer row");

setPresentationStyle("droid");
const droidUserRaw = new UserMessageComponent("hello").render(40);
const droidUser = droidUserRaw.map(stripAnsi);
assert(droidUserRaw.some((line) => line.includes("\x1b[48;")), "droid user should retain its background card");
assert(droidUser.some((line) => line.includes("─".repeat(40))), "droid user should retain its divider");
const droidAssistant = new AssistantMessageComponent(assistantMessage).render(40).map(stripAnsi);
assert(droidAssistant.some((line) => line.includes("─".repeat(40))), "droid assistant should retain its divider");

const { renderCompactBoxedToolCall, renderCompactBoxedFooter, renderBoxedToolResult, setCompactBoxedFooter } = await importBuilt("tool-tags/common.js");
const { installQuickEditRenderer } = await importBuilt("tool-tags/quick-edit.js");
const { installCompactToolSpacing, normalizeReasonixToolLines, setToolSpacingTheme } = await importBuilt("tool-tags/compact-tool-spacing.js");

setPresentationStyle("reasonix");
const toolState = {};
renderCompactBoxedFooter(activeTheme, { content: [{ type: "text", text: "updated file" }] }, { state: toolState });
const compactTool = renderCompactBoxedToolCall(activeTheme, "Read", "src/config.ts", { state: toolState });
const compactToolLines = compactTool.render(80).map(stripAnsi);
assert(compactToolLines.length === 2, "reasonix collapsed tool component should render header plus metrics row");
assert(compactToolLines[0]?.startsWith("✓") && compactToolLines[0]?.includes("Read") && compactToolLines[0]?.includes("src/config.ts"), "reasonix completed header should retain semantic success status, tool name, and subject");
assert(compactToolLines[1]?.startsWith("  └─ ") && compactToolLines[1]?.includes("◷"), "reasonix collapsed metrics should occupy the first output position");
assert(!compactToolLines.some((line) => line.includes("┌")), "reasonix collapsed tool should not render an outer box");

const longMultilineSubject = Array.from({ length: 40 }, (_, index) => `part-${index}`).join("\n");
const responsiveSubjectNarrow = renderCompactBoxedToolCall(activeTheme, "Bash", longMultilineSubject).render(24).map(stripAnsi);
const responsiveSubjectMedium = renderCompactBoxedToolCall(activeTheme, "Bash", longMultilineSubject).render(80).map(stripAnsi);
const responsiveSubjectWide = renderCompactBoxedToolCall(activeTheme, "Bash", longMultilineSubject).render(160).map(stripAnsi);
assert(responsiveSubjectNarrow.length === 1 && !responsiveSubjectNarrow[0]?.includes("\n") && (responsiveSubjectNarrow[0]?.length ?? 0) <= 24, "reasonix collapsed tool subject should stay on one physical row at narrow widths");
assert((responsiveSubjectMedium[0]?.length ?? 0) === 48, "reasonix collapsed tool subject should use a 60% soft cap at medium widths");
assert((responsiveSubjectWide[0]?.length ?? 0) === 72, "reasonix collapsed tool subject should stop at the 72-column hard cap on wide terminals");
const dimEllipsisTheme = { ...activeTheme, fg: (color, text) => color === "dim" ? `\x1b[2m${text}\x1b[22m` : activeTheme.fg(color, text) };
const dimEllipsisRaw = renderCompactBoxedToolCall(dimEllipsisTheme, "Bash", longMultilineSubject).render(80);
assert(dimEllipsisRaw[0]?.includes("\x1b[2m…\x1b[22m"), "reasonix collapsed subject ellipsis should be dimmed");
const noEllipsisRaw = renderCompactBoxedToolCall(dimEllipsisTheme, "Bash", "npm test").render(80);
assert(!noEllipsisRaw[0]?.includes("…"), "reasonix collapsed subject should not show ellipsis when it fits the soft cap");

const longErrorState = {};
setCompactBoxedFooter(longErrorState, activeTheme.fg("error", Array.from({ length: 40 }, (_, index) => `failure-${index}`).join("\n")), { isError: true });
const responsiveErrorLines = renderCompactBoxedToolCall(activeTheme, "Bash", "failing command", { state: longErrorState }).render(80).map(stripAnsi);
assert(responsiveErrorLines.length === 2 && !responsiveErrorLines[1]?.includes("\n") && (responsiveErrorLines[1]?.length ?? 0) <= 48, "reasonix collapsed error should share the responsive 60% soft cap");
const dimErrorState = {};
setCompactBoxedFooter(dimErrorState, dimEllipsisTheme.fg("error", Array.from({ length: 40 }, (_, index) => `failure-${index}`).join("\n")), { isError: true });
const dimErrorRaw = renderCompactBoxedToolCall(dimEllipsisTheme, "Bash", "failing command", { state: dimErrorState }).render(80);
assert(dimErrorRaw[1]?.includes("\x1b[2m…\x1b[22m"), "reasonix collapsed error ellipsis should be dimmed");

const expandedTool = renderBoxedToolResult(activeTheme, () => ["full detail line one", "full detail line two"], { footerLines: ["0.20s"] });
const expandedToolLines = expandedTool.render(80).map(stripAnsi);
assert(expandedToolLines.some((line) => line.includes("full detail line one")), "reasonix expanded tool should retain full body");
assert(expandedToolLines.some((line) => line.includes("full detail line two")), "reasonix expanded tool should retain all body lines");
assert(!expandedToolLines.some((line) => line.includes("┌") || line.includes("│")), "reasonix expanded tool should use indentation without a box or rail");
assert(expandedToolLines[0]?.startsWith("  └─ "), "reasonix expanded tool should connect the first output line with a corner");
assert(expandedToolLines.slice(1).every((line) => line.startsWith("     ")), "reasonix expanded continuation lines should align below the corner");
assert(expandedTool.render(24).every((line) => stripAnsi(line).length <= 24), "reasonix expanded body should fit narrow terminals");

setToolSpacingTheme(activeTheme);
const bashLikeLines = [
	activeTheme.fg("text", "✓ Bash npm test"),
	"  └─ preview one",
	"     preview two",
	`     ${activeTheme.fg("text", "◷")} ${activeTheme.fg("dim", "1.20s · 4 words")}`,
];
const collapsedBashLike = normalizeReasonixToolLines(bashLikeLines, 80, false).map(stripAnsi);
assert(collapsedBashLike.length === 3 && collapsedBashLike.at(-1) === "", "reasonix collapsed tool should render two visible rows plus one spacer");
assert(collapsedBashLike[0]?.includes("Bash npm test") && !collapsedBashLike[0]?.includes("1.20s"), "reasonix collapsed header should retain call subject without inline metrics");
assert(collapsedBashLike[1]?.startsWith("  └─ ") && collapsedBashLike[1]?.includes("1.20s"), "reasonix collapsed metrics should occupy the first output position");
assert(!collapsedBashLike.some((line) => line.includes("preview")), "reasonix collapsed tool should discard every preview body line");
const narrowCollapsedBashLike = normalizeReasonixToolLines(bashLikeLines, 24, false).map(stripAnsi);
assert((narrowCollapsedBashLike[1]?.length ?? 0) <= 24 && narrowCollapsedBashLike[1]?.includes("1.20s"), "reasonix narrow collapsed metrics should retain duration without overflow");
const softCappedBashLike = normalizeReasonixToolLines([activeTheme.fg("text", `✓ Bash ${"x".repeat(200)}`), ...bashLikeLines.slice(1)], 80, false).map(stripAnsi);
assert((softCappedBashLike[0]?.length ?? 0) === 48 && (softCappedBashLike[1]?.length ?? 0) <= 48, "reasonix generic collapsed tools should share the 60% soft cap");
setToolSpacingTheme(dimEllipsisTheme);
const dimGenericBashLike = normalizeReasonixToolLines([dimEllipsisTheme.fg("text", `✓ Bash ${"x".repeat(200)}`), ...bashLikeLines.slice(1)], 80, false);
assert(dimGenericBashLike[0]?.includes("\x1b[2m…\x1b[22m"), "reasonix generic collapsed ellipsis should be dimmed");
setToolSpacingTheme(activeTheme);
const expandedFullWidthBashLike = normalizeReasonixToolLines([activeTheme.fg("text", `✓ Bash ${"x".repeat(200)}`), ...bashLikeLines.slice(1)], 80, true).map(stripAnsi);
assert((expandedFullWidthBashLike[0]?.length ?? 0) === 80, "reasonix expanded tools should keep the full available terminal width");
const expandedBashLike = normalizeReasonixToolLines(["", "─".repeat(80), ...bashLikeLines, ""], 80, true).map(stripAnsi);
assert(expandedBashLike.length === 5 && expandedBashLike.at(-1) === "", "reasonix expanded tool should preserve summary, output, footer, and one spacer");
assert(!expandedBashLike[0]?.includes("1.20s"), "reasonix expanded header should not inline footer metrics");
assert(expandedBashLike[1]?.startsWith("  └─ ") && expandedBashLike[2]?.startsWith("     "), "reasonix expanded output should keep its corner connector and aligned continuation");
assert(expandedBashLike[3]?.includes("1.20s"), "reasonix expanded footer metrics should remain below output");

class FakeSpacingToolExecution {
	constructor(expanded) { this.expanded = expanded; }
	render() { return ["", "─".repeat(80), ...bashLikeLines, ""]; }
}
installCompactToolSpacing(FakeSpacingToolExecution);
assert(new FakeSpacingToolExecution(false).render(80).length === 3, "reasonix ToolExecution patch should enforce two collapsed visible rows plus spacing");
assert(new FakeSpacingToolExecution(true).render(80).length === 5, "reasonix ToolExecution patch should preserve expanded body/footer plus spacing");

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
assert(collapsedQuickEditLines.length === 2, "reasonix quick-edit collapsed component should render header plus metrics row");
assert(collapsedQuickEditLines[1]?.startsWith("  └─ ") && collapsedQuickEditLines[1]?.includes("+1") && collapsedQuickEditLines[1]?.includes("-1"), "reasonix quick-edit collapsed metrics row should retain diff stats");

const quickEditErrorState = {};
const quickEditErrorCall = quickEditCallRenderer({ path: "src/demo.ts" }, activeTheme, { state: quickEditErrorState, cwd: process.cwd() });
const collapsedQuickEditError = quickEditRenderer(
	{ isError: true, content: [{ type: "text", text: "edit failed" }] },
	{ expanded: false },
	activeTheme,
	{ state: quickEditErrorState, isError: true, args: { path: "src/demo.ts" }, cwd: process.cwd() },
);
assert(collapsedQuickEditError.render(80).length === 0, "reasonix quick-edit error should fold into the call row");
const quickEditErrorLines = quickEditErrorCall.render(80).map(stripAnsi);
assert(quickEditErrorLines[0]?.includes("✗") && quickEditErrorLines[1]?.startsWith("  └─ ") && quickEditErrorLines[1]?.includes("edit failed"), "reasonix quick-edit collapsed error should retain status and message across header/output rows");

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
