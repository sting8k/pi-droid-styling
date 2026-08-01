#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

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
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
}
declare module "url" {
	export const fileURLToPath: (url: string) => string;
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
	let header;
	const theme = {
		bold: (text) => text,
		fg: (color, text) => {
			calls.push([color, text]);
			return text;
		},
		getFgAnsi: () => "\x1b[38;2;97;175;239m",
		getColorMode: () => "truecolor",
	};
	process.env.HOME = join(workDir, "home");
	mkdirSync(process.env.HOME, { recursive: true });
	setCompactStartupHeader({
		setHeader(factory) {
			header = factory(null, theme);
		},
	}, workDir);

	class FakeInteractive {
		options = {};
		chatContainer = { children: [], addChild(child) { this.children.push(child); } };
		settingsManager = { getQuietStartup: () => false };
		sessionManager = { getCwd: () => workDir };
		session = {
			state: { messages: [] },
			promptTemplates: [],
			scopedModels: [],
			model: { provider: "opencode-go", id: "deepseek-v4-flash-free" },
			thinkingLevel: "high",
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
	const banner = instance.chatContainer.children.find((child) => typeof child.render === "function");
	const lines = instance.chatContainer.children.flatMap((child) => typeof child.render === "function" ? child.render(96) : []);

	// Resumed sessions must not inject the welcome banner.
	instance.session.state = { messages: [{ role: "user", content: "hi" }] };
	instance.chatContainer.children = [];
	instance.showLoadedResources({ force: true });
	assert(instance.chatContainer.children.length === 0, "welcome banner should not appear on resumed sessions");

	return { banner, calls, header, lines: lines.map((line) => line.trimEnd()) };
}

function assertStartupResources({ banner, calls, header, lines }) {
	const output = lines.join("\n");
	console.log(output);

	// Claude Code-style bordered welcome: greeting + tips + context + what's new
	assert(output.includes("Welcome back!"), "missing Welcome greeting");
	assert(output.includes("Pi v"), "missing Pi version border label");
	assert(output.includes("╭"), "missing top rounded border");
	assert(output.includes("╰"), "missing bottom rounded border");
	assert(output.includes("Tips for getting started"), "missing Tips section");
	assert(output.includes("/commands"), "missing /commands tip");
	assert(output.includes("/model"), "missing /model tip");
	assert(output.includes("/tree"), "missing /tree tip");
	assert(output.includes("• Run"), "missing tip bullets");
	assert(output.includes("Open") && output.includes("/tree"), "missing /tree tip copy");
	assert(output.includes("Context"), "missing Context section");
	assert(output.includes("custom system prompt"), "missing system prompt in Context");
	assert(output.includes("AGENTS.md"), "missing context file in Context");
	assert(output.includes("What's new"), "missing What's new section");
	assert(output.includes("/changelog"), "missing /changelog link");
	assert(!/inactive/.test(output), "inactive tool leaked into output");

	// Left column meta: model + cwd only (no effort). Long provider/id may drop provider.
	assert(output.includes("───") || output.includes("─".repeat(8)), "missing section divider");
	assert(
		output.includes("opencode-go/deepseek-v4-flash-free") || output.includes("deepseek-v4-flash-free"),
		"missing live model meta (full or id-only)",
	);
	assert(!output.includes("Default model"), "should not fall back to Default model when session.model is set");
	assert(!/\beffort\b/.test(output), "effort label should not appear under the logo");

	// Path truncation: the long agents path should be truncated
	assert(output.includes("…"), "long context path was not truncated");

	// Natural language tips (Claude Code-style)
	assert(output.includes("Run") && output.includes("/commands"), "missing natural-language tip style");
	assert(output.includes("Open") && output.includes("/tree"), "missing /tree natural-language tip style");

	// System/context kinds use dim
	assert(calls.some(([color, text]) => color === "dim" && text.includes("system")), "missing dim color call for system kind");
	// Context path uses accent (like Claude Code's muted highlighting)
	assert(calls.some(([color, text]) => color === "accent" && text.includes("AGENTS.md")), "missing accent color call for context path");
	// Commands tips use accent
	assert(calls.some(([color, text]) => color === "accent" && text.includes("/commands")), "missing accent color call for /commands");
	// Border / section rules use accent
	assert(calls.some(([color, text]) => color === "accent" && text.includes("─")), "missing accent color call for welcome borders");

	assert(header, "startup header component was not installed");
	assert(header.render(96).length === 0, "built-in startup header should stay hidden");
	assert(banner, "welcome banner component was not installed");
	const gradientColors = new Set(
		[...output.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => match.slice(1).join(";")),
	);
	assert(gradientColors.size > 1, "welcome logo did not render a color gradient");
	for (const width of [12, 24, 40, 96]) {
		for (const line of banner.render(width)) {
			assert(visibleWidth(line) <= width, `welcome banner exceeds width ${width}: ${visibleWidth(line)}`);
		}
	}
	console.log("startup resources smoke ok");
}

prepareWorkDir();
compileChangedSurface();
initTheme("dark");
const startupUi = await import(pathToFileURL(join(buildDir, "startup-ui.js")).href);
assertStartupResources(renderStartupResources(startupUi));
