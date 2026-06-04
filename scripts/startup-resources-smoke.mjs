#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "startup-resources-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const readFileSync: (path: string, encoding: string) => string;
}
declare module "os" {
	export const homedir: () => string;
}
declare module "path" {
	export const join: (...parts: string[]) => string;
}
declare const process: any;
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:startup-resources");
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
		"startup-ui.ts",
		"render-budget.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc startup resources ok");
}

function renderStartupResources({ installStartupUiPatch, setCompactStartupHeader }) {
	const calls = [];
	const theme = {
		bold: (text) => text,
		fg: (color, text) => {
			calls.push([color, text]);
			return text;
		},
	};
	process.env.HOME = join(workDir, "home");
	mkdirSync(process.env.HOME, { recursive: true });
	setCompactStartupHeader({
		setHeader(factory) {
			factory(null, theme);
		},
	}, workDir);

	class FakeInteractive {
		options = {};
		chatContainer = { children: [], addChild(child) { this.children.push(child); } };
		settingsManager = { getQuietStartup: () => false };
		sessionManager = { getCwd: () => workDir };
		session = {
			promptTemplates: [],
			scopedModels: [],
			getActiveToolNames: () => [
				"bash", "find", "grep", "ls", "read", "write", "TaskCreate", "TaskList", "TaskUpdate",
				"review", "search", "customTool", "gitWrite",
			],
			getAllTools: () => [
				...[
					"bash", "find", "grep", "ls", "read", "write", "TaskCreate", "TaskList", "TaskUpdate",
				].map((name) => ({ name, sourceInfo: { source: "builtin", path: `<builtin:${name}>` } })),
				{ name: "review", sourceInfo: { source: "local", path: "./index.ts", baseDir: "/tmp/review-ext" } },
				{ name: "search", sourceInfo: { source: "local", path: "./index.ts", baseDir: "/tmp/review-ext" } },
				{ name: "customTool", sourceInfo: { source: "npm:pi-tools", path: "/tmp/node_modules/pi-tools/extensions/index.ts" } },
				{ name: "gitWrite", sourceInfo: { source: "git:https://github.com/acme/git-tools.git", path: "/tmp/git-tools/index.ts" } },
				{ name: "inactive", sourceInfo: { source: "builtin", path: "<builtin:inactive>" } },
			],
			resourceLoader: {
				getSkills: () => ({ skills: [] }),
				getThemes: () => ({ themes: [] }),
				getExtensions: () => ({ extensions: [] }),
				getAgentsFiles: () => ({ agentsFiles: [{ path: "a/very/long/project/context/path/that/should/truncate/AGENTS.md", content: "one two\nthree" }] }),
				getSystemPrompt: () => "system words\nmore",
				getAppendSystemPrompt: () => [],
			},
		};
		showLoadedResources() {}
		getCompactExtensionLabels(extensions) { return extensions.map((extension) => extension.path); }
		getCompactPathLabel(path) { return path; }
		formatContextPath(path) { return path; }
		getStartupExpansionState() { return true; }
	}

	installStartupUiPatch(FakeInteractive);
	const instance = new FakeInteractive();
	instance.showLoadedResources({ force: true });
	const lines = instance.chatContainer.children.flatMap((child) => typeof child.render === "function" ? child.render(96) : []);
	return { calls, lines: lines.map((line) => line.trimEnd()) };
}

function assertStartupResources({ calls, lines }) {
	const output = lines.join("\n");
	console.log(output);

	const systemIndex = output.indexOf("System & Context");
	const toolsIndex = output.indexOf("Available Tools");
	assert(systemIndex >= 0, "missing System & Context panel");
	assert(toolsIndex > systemIndex, "Available Tools panel is not below System & Context");
	assert(/tools\D+13/.test(output), "resources summary did not count active tools");
	assert(/Source\s+\| Count \| Tools/.test(output), "tools panel did not render Source header");
	assert(!/Prefix\s+\|/.test(output), "old Prefix header is still rendered");
	assert(/core\D+9\D+bash/.test(output), "builtin tools were not grouped under core");
	assert(/review-ext\D+2\D+review, search/.test(output), "local extension tools were not grouped by extension baseDir");
	assert(/pi-tools\D+1\D+customTool/.test(output), "npm extension tools were not grouped by package source");
	assert(/git-tools\D+1\D+gitWrite/.test(output), "git extension tools were not grouped by git source");
	assert(!/inactive/.test(output), "inactive tool leaked into active tools panel");
	assert(output.includes("..."), "long path or tool list was not truncated with ...");

	const topBorders = lines.filter((line) => line.trimStart().startsWith("┌"));
	assert(topBorders.length === 2, "expected exactly two expanded resource panels");
	const borderWidths = topBorders.map((line) => line.trimStart().length);
	assert(borderWidths[0] === borderWidths[1], "System & Context and Available Tools panel widths differ");
	for (const line of lines.filter((line) => line.trimStart().startsWith("│") || line.trimStart().startsWith("┌") || line.trimStart().startsWith("└"))) {
		assert(line.trimStart().length <= borderWidths[0], `panel line exceeds shared width: ${line}`);
	}

	for (const expectedText of ["Type", "system", "a/very", "Source", "core", "review-ext", "bash"]) {
		assert(calls.some(([color, text]) => color === "text" && text.includes(expectedText)), `missing bright text color call for ${expectedText}`);
	}
	console.log("startup resources smoke ok");
}

prepareWorkDir();
compileChangedSurface();
const startupUi = await import(pathToFileURL(join(buildDir, "startup-ui.js")).href);
assertStartupResources(renderStartupResources(startupUi));
