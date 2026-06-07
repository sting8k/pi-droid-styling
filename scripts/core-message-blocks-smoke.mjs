#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "core-message-blocks-smoke");
const buildDir = join(workDir, "build");
const themeSourcePath = join(workDir, "smoke-theme.json");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;
const PAGE_BG = "\x1b[48;2;1;2;3m";
const CUSTOM_MESSAGE_BG = "\x1b[48;5;236m";


function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function stripAnsi(text) {
	return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function resetCoreMessageBlockPatchFlag() {
	delete globalThis.__droidCoreMessageBlocksPatched__;
}

function assertUsesPageBackground(lines, label) {
	assert(lines.some((line) => line.includes(PAGE_BG)), `${label} should use common page background`);
	assert(!lines.some((line) => line.includes(CUSTOM_MESSAGE_BG)), `${label} should not use brighter customMessageBg`);
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(themeSourcePath, JSON.stringify({
		name: "droid-smoke",
		vars: { bg: "#010203", customMessageBg: "#1f2328" },
		export: { pageBg: "bg" },
	}) + "\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
}
declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
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
}
declare module "node:os" {
	export const homedir: () => string;
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare const process: any;
declare type Buffer = any;
declare const Buffer: any;
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:core-message-blocks");
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
		"messages/boxed-message-block.ts",
		"messages/core-message-blocks.ts",
		"tool-tags/common.ts",
		"render-budget.ts",
		"theme/ansi.ts",
		"theme/theme-extras.ts",
		"performance/profiler.ts",
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

function makeTheme() {
	return {
		name: "droid-smoke",
		sourcePath: themeSourcePath,
		fg: (color, text) => {
			if (color === "dim") return `\x1b[2m${text}\x1b[22m`;
			if (color === "bashMode") return `\x1b[36m${text}\x1b[39m`;
			if (color === "customMessageText") return `\x1b[37m${text}\x1b[39m`;
			return text;
		},
		bg: (color, text) => {
			if (color === "customMessageBg") return `\x1b[48;5;236m${text}\x1b[49m`;
			return text;
		},
		getBgAnsi: (color) => {
			if (color === "customMessageBg") return "\x1b[48;5;236m";
			return "";
		},
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
	};
}

async function runBoxedMessageBlockSmoke() {
	const { renderBoxedMessageBlock } = await importBuilt("messages/boxed-message-block.js");
	const theme = makeTheme();

	// Test collapsed block with right hint
	const collapsedBlock = renderBoxedMessageBlock(theme, {
		kind: "Skill",
		title: "plan",
		right: "(Ctrl+O to expand)",
		body: () => [],
		hasDivider: false,
	});
	const collapsedLines = collapsedBlock.render(60);
	const collapsedStripped = collapsedLines.map(stripAnsi);

	assert(collapsedLines.length === 3, `collapsed block should have 3 lines (top, title, bottom), got ${collapsedLines.length}`);
	assert(collapsedStripped[0]?.startsWith("┌"), "collapsed block should start with top border");
	assert(collapsedStripped[1]?.includes("➔ Skill | plan"), "collapsed block should have formatted title");
	assert(collapsedStripped[1]?.includes("(Ctrl+O to expand)"), "collapsed block should have right hint");
	assert(!collapsedLines.some((line) => line.includes(CUSTOM_MESSAGE_BG)), "message block child should not apply background - parent Box handles it");
	assert(!collapsedLines.some((line) => line.includes(PAGE_BG)), "message block child should not apply pageBg - parent Box handles it");
	assert(collapsedStripped[2]?.startsWith("└"), "collapsed block should end with bottom border");
	console.log("boxed message block collapsed smoke ok");

	// Test expanded block with divider and body
	const expandedBlock = renderBoxedMessageBlock(theme, {
		kind: "Compaction",
		title: "123,456 tokens",
		body: (contentWidth) => ["Compacted summary line 1", "Compacted summary line 2"],
		hasDivider: true,
	});
	const expandedLines = expandedBlock.render(60);
	const expandedStripped = expandedLines.map(stripAnsi);

	assert(expandedLines.length === 6, `expanded block should have 6 lines (top, title, divider, body1, body2, bottom), got ${expandedLines.length}`);
	assert(expandedStripped[0]?.startsWith("┌"), "expanded block should start with top border");
	assert(expandedStripped[1]?.includes("➔ Compaction | 123,456 tokens"), "expanded block should have formatted title");
	assert(expandedStripped[2]?.includes("─"), "expanded block should have divider");
	assert(expandedStripped[3]?.includes("Compacted summary line 1"), "expanded block should have body line 1");
	assert(expandedStripped[4]?.includes("Compacted summary line 2"), "expanded block should have body line 2");
	assert(expandedStripped[5]?.startsWith("└"), "expanded block should end with bottom border");
	console.log("boxed message block expanded smoke ok");

	// Test block without title
	const noTitleBlock = renderBoxedMessageBlock(theme, {
		kind: "Branch",
		body: () => ["Branch summary content"],
		hasDivider: true,
	});
	const noTitleLines = noTitleBlock.render(60);
	const noTitleStripped = noTitleLines.map(stripAnsi);
	assert(noTitleStripped[1]?.includes("➔ Branch"), "block without title should show kind only");
	assert(!noTitleStripped[1]?.includes("|"), "block without title should not have pipe separator");
	console.log("boxed message block no-title smoke ok");
}

async function runInstallerSmoke() {
	resetCoreMessageBlockPatchFlag();
	const { installCoreMessageBlockStyling, setCoreMessageBlockTheme } = await importBuilt("messages/core-message-blocks.js");
	const theme = makeTheme();

	// Test that installer can be called without throwing
	setCoreMessageBlockTheme(theme);
	installCoreMessageBlockStyling({
		CompactionSummaryMessageComponent: { prototype: {} },
		SkillInvocationMessageComponent: { prototype: {} },
		BranchSummaryMessageComponent: { prototype: {} },
		CustomMessageComponent: { prototype: {} },
	});
	console.log("installer no-throw smoke ok");

	// Test that missing components don't throw
	installCoreMessageBlockStyling({});
	console.log("installer missing-components smoke ok");
}

async function runBoxBackedComponentBackgroundSmoke() {
	resetCoreMessageBlockPatchFlag();
	const {
		BranchSummaryMessageComponent,
		CompactionSummaryMessageComponent,
		SkillInvocationMessageComponent,
	} = await import("@earendil-works/pi-coding-agent");
	const { installCoreMessageBlockStyling, setCoreMessageBlockTheme } = await importBuilt("messages/core-message-blocks.js");
	const theme = makeTheme();

	setCoreMessageBlockTheme(theme);
	installCoreMessageBlockStyling({
		BranchSummaryMessageComponent,
		CompactionSummaryMessageComponent,
		SkillInvocationMessageComponent,
	});

	const components = [
		["compaction", new CompactionSummaryMessageComponent({ tokensBefore: 123456, summary: "summary" }, undefined)],
		["skill", new SkillInvocationMessageComponent({ name: "plan", content: "body" }, undefined)],
		["branch", new BranchSummaryMessageComponent({ summary: "branch summary" }, undefined)],
	];

	for (const [label, component] of components) {
		assertUsesPageBackground(component.render(60), label);
	}
	console.log("box-backed component background smoke ok");
}

async function runBranchNullGuardSmoke() {
	resetCoreMessageBlockPatchFlag();
	const { installCoreMessageBlockStyling, setCoreMessageBlockTheme } = await importBuilt("messages/core-message-blocks.js");
	const theme = makeTheme();
	let baseCalls = 0;

	class BranchSummaryMessageComponent {
		constructor() {
			this.message = null;
			this.children = ["native"];
		}

		updateDisplay() {
			baseCalls += 1;
			this.baseRendered = true;
		}

		clear() {
			this.children = [];
		}

		addChild(component) {
			this.children.push(component);
		}
	}

	setCoreMessageBlockTheme(theme);
	installCoreMessageBlockStyling({ BranchSummaryMessageComponent });

	const branch = new BranchSummaryMessageComponent();
	branch.updateDisplay();
	assert(baseCalls === 1, `branch null message should call base updateDisplay, got ${baseCalls}`);
	assert(branch.baseRendered === true, "branch null message should use native base display");
	assert(branch.children.length === 1 && branch.children[0] === "native", "branch null message should not clear native children");
	console.log("branch null message guard smoke ok");
}

async function runCustomMessageComponentSmoke() {
	resetCoreMessageBlockPatchFlag();
	const { CustomMessageComponent } = await import("@earendil-works/pi-coding-agent");
	const { installCoreMessageBlockStyling, setCoreMessageBlockTheme } = await importBuilt("messages/core-message-blocks.js");
	const theme = makeTheme();

	setCoreMessageBlockTheme(theme);
	installCoreMessageBlockStyling({ CustomMessageComponent });

	const fallback = new CustomMessageComponent({ customType: "probe", content: "hello" }, undefined);
	assertUsesPageBackground(fallback.render(60), "custom fallback");
	const first = fallback.render(60).map(stripAnsi);
	fallback.rebuild();
	const second = fallback.render(60).map(stripAnsi);
	const firstCount = first.filter((line) => line.includes("⊟ Custom | probe")).length;
	const secondCount = second.filter((line) => line.includes("⊟ Custom | probe")).length;
	assert(firstCount === 1, `custom fallback should render one boxed block initially, got ${firstCount}`);
	assert(secondCount === 1, `custom fallback should not duplicate after rebuild, got ${secondCount}`);
	assert(second.length === first.length, `custom fallback rebuild should keep line count stable, before=${first.length} after=${second.length}`);
	console.log("custom message fallback rebuild smoke ok");

	resetCoreMessageBlockPatchFlag();
	class NoBoxCustomMessageComponent {
		constructor(message) {
			this.message = message;
			this.children = [];
			this._expanded = false;
			this.rebuild();
		}
		rebuild() {}
		addChild(component) {
			this.children.push(component);
		}
		removeChild(component) {
			this.children = this.children.filter((child) => child !== component);
		}
		render(width) {
			return this.children.flatMap((child) => child.render(width));
		}
	}
	installCoreMessageBlockStyling({ CustomMessageComponent: NoBoxCustomMessageComponent });
	const noBox = new NoBoxCustomMessageComponent({ customType: "nobox", content: "hello" });
	assertUsesPageBackground(noBox.render(60), "custom no-box fallback");
	const noBoxFirst = noBox.render(60).map(stripAnsi);
	noBox.rebuild();
	const noBoxSecond = noBox.render(60).map(stripAnsi);
	assert(noBoxFirst.filter((line) => line.includes("⊟ Custom | nobox")).length === 1, "custom no-box fallback should render one boxed block initially");
	assert(noBoxSecond.filter((line) => line.includes("⊟ Custom | nobox")).length === 1, "custom no-box fallback should not duplicate after rebuild");
	console.log("custom message no-box fallback background smoke ok");

	const customRendered = { render: () => ["custom renderer output"] };
	const rendered = new CustomMessageComponent({ customType: "rendered", content: "ignored" }, () => customRendered);
	const renderedLines = rendered.render(60).map(stripAnsi);
	rendered.rebuild();
	const rerenderedLines = rendered.render(60).map(stripAnsi);
	assert(rerenderedLines.some((line) => line.includes("custom renderer output")), "custom renderer output should be preserved");
	assert(!rerenderedLines.some((line) => line.includes("⊟ Custom | rendered")), "custom renderer output should not be wrapped by fallback box");
	assert(rerenderedLines.length === renderedLines.length, "custom renderer rebuild should keep line count stable");
	console.log("custom message renderer passthrough smoke ok");
}

async function runPatchedComponentSmoke() {
	// Reset the global patch flag by creating a new module instance
	// Since we can't easily reset Symbol.for, we'll test the patch logic directly
	const { renderBoxedMessageBlock } = await importBuilt("messages/boxed-message-block.js");
	const theme = makeTheme();

	// Simulate what a patched component would do
	function simulatePatchedCompaction(expanded, tokensBefore, summary) {
		const tokenStr = tokensBefore.toLocaleString();
		const body = expanded && summary
			? (contentWidth) => [summary]
			: () => [];

		const block = renderBoxedMessageBlock(theme, {
			kind: "Compaction",
			title: `${tokenStr} tokens`,
			right: expanded ? undefined : "(Ctrl+O to expand)",
			body,
			icon: "⊟",
			hasDivider: expanded,
		});
		return block.render(80).map(stripAnsi);
	}

	// Test collapsed compaction
	const collapsed = simulatePatchedCompaction(false, 123456, "This is a long summary");
	assert(collapsed.length === 3, `collapsed compaction should have 3 lines, got ${collapsed.length}`);
	assert(collapsed[1]?.includes("123,456 tokens"), "collapsed compaction should show token count in title");
	assert(collapsed[1]?.includes("(Ctrl+O to expand)"), "collapsed compaction should show expand hint");
	console.log("patched compaction collapsed smoke ok");

	// Test expanded compaction
	const expanded = simulatePatchedCompaction(true, 123456, "This is a long summary");
	assert(expanded.length === 5, `expanded compaction should have 5 lines, got ${expanded.length}`);
	assert(expanded[1]?.includes("123,456 tokens"), "expanded compaction should show token count in title");
	assert(!expanded[1]?.includes("(Ctrl+O to expand)"), "expanded compaction should not show expand hint");
	assert(expanded[3]?.includes("This is a long summary"), "expanded compaction should show summary");
	console.log("patched compaction expanded smoke ok");

	// Simulate patched skill
	function simulatePatchedSkill(expanded, skillName, content) {
		const body = expanded && content
			? (contentWidth) => [content]
			: () => [];

		const block = renderBoxedMessageBlock(theme, {
			kind: "Skill",
			title: skillName,
			right: expanded ? undefined : "(Ctrl+O to expand)",
			body,
			icon: "⊟",
			hasDivider: expanded,
		});
		return block.render(80).map(stripAnsi);
	}

	const skillCollapsed = simulatePatchedSkill(false, "plan", "Plan content");
	assert(skillCollapsed[1]?.includes("⊟ Skill | plan"), "collapsed skill should show skill name in title");
	console.log("patched skill collapsed smoke ok");

	const skillExpanded = simulatePatchedSkill(true, "plan", "Plan content");
	assert(skillExpanded[3]?.includes("Plan content"), "expanded skill should show content");
	console.log("patched skill expanded smoke ok");
}

async function main() {
	prepareWorkDir();
	compileChangedSurface();
	await runBoxedMessageBlockSmoke();
	await runInstallerSmoke();
	await runBoxBackedComponentBackgroundSmoke();
	await runBranchNullGuardSmoke();
	await runCustomMessageComponentSmoke();
	await runPatchedComponentSmoke();
	console.log("core-message-blocks smoke ok");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
