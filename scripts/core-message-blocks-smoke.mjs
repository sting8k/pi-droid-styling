#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "core-message-blocks-smoke");
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
		bgName: "customMessageBg",
		hasDivider: false,
	});
	const collapsedLines = collapsedBlock.render(60);
	const collapsedStripped = collapsedLines.map(stripAnsi);

	assert(collapsedLines.length === 3, `collapsed block should have 3 lines (top, title, bottom), got ${collapsedLines.length}`);
	assert(collapsedStripped[0]?.startsWith("┌"), "collapsed block should start with top border");
	assert(collapsedStripped[1]?.includes("➔ Skill | plan"), "collapsed block should have formatted title");
	assert(collapsedStripped[1]?.includes("(Ctrl+O to expand)"), "collapsed block should have right hint");
	assert(collapsedStripped[2]?.startsWith("└"), "collapsed block should end with bottom border");
	console.log("boxed message block collapsed smoke ok");

	// Test expanded block with divider and body
	const expandedBlock = renderBoxedMessageBlock(theme, {
		kind: "Compaction",
		title: "123,456 tokens",
		body: (contentWidth) => ["Compacted summary line 1", "Compacted summary line 2"],
		bgName: "customMessageBg",
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
		bgName: "customMessageBg",
		hasDivider: true,
	});
	const noTitleLines = noTitleBlock.render(60);
	const noTitleStripped = noTitleLines.map(stripAnsi);
	assert(noTitleStripped[1]?.includes("➔ Branch"), "block without title should show kind only");
	assert(!noTitleStripped[1]?.includes("|"), "block without title should not have pipe separator");
	console.log("boxed message block no-title smoke ok");
}

async function runInstallerSmoke() {
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
			bgName: "customMessageBg",
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
			bgName: "customMessageBg",
			hasDivider: expanded,
		});
		return block.render(80).map(stripAnsi);
	}

	const skillCollapsed = simulatePatchedSkill(false, "plan", "Plan content");
	assert(skillCollapsed[1]?.includes("➔ Skill | plan"), "collapsed skill should show skill name in title");
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
	await runPatchedComponentSmoke();
	console.log("core-message-blocks smoke ok");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
