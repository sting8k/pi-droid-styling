#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "working-message-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const renameSync: (from: string, to: string) => void;
	export const unlinkSync: (path: string) => void;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
}
declare module "os" {
	export const homedir: () => string;
}
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:working-message");
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
		"config.ts",
		"tool-tags/loader-accent.ts",
		"index.ts",
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

function writeInitialConfig(homeDir, initialJson) {
	if (initialJson === undefined) return;
	const configDir = join(homeDir, ".pi", "agent");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "pi-droid-styling.json"), `${initialJson}\n`, "utf8");
}

async function runConfigSmoke(name, initialJson, validate) {
	const homeDir = join(workDir, `home-${name.replace(/[^a-z0-9]+/gi, "-")}`);
	mkdirSync(homeDir, { recursive: true });
	writeInitialConfig(homeDir, initialJson);
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const { loadConfig } = await importBuilt("config.js");
	const config = loadConfig();
	const raw = JSON.parse(readFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), "utf8"));
	validate({ config, raw });
	console.log(`config smoke ok: ${name}`);
}

async function runLoaderSmoke() {
	const { createWorkingLoaderController, createWorkingIndicatorFrames, renderWorkingMessage } = await importBuilt("tool-tags/loader-accent.js");
	const labels = { working: "Doing", thinking: "Pondering", answering: "Replying", running: "Executing" };
	assert(renderWorkingMessage("running", 0, undefined, labels) === "Executing", "custom running render failed");
	assert(renderWorkingMessage("thinking", 1, undefined, labels) === "Pondering", "custom thinking render failed");

	// Shimmer: the head moves one character per step, then rests 6 steps between sweeps.
	const markTheme = { fg: (color, text) => `<${color}:${text}>`, bold: (text) => `*${text}*` };
	assert(renderWorkingMessage("working", 0, markTheme, labels) === "<text:*D*><text:o><muted:i><muted:n><muted:g>", "shimmer head at step 0 failed");
	assert(renderWorkingMessage("working", 2, markTheme, labels) === "<muted:D><text:o><text:*i*><text:n><muted:g>", "shimmer head at step 2 failed");
	assert(renderWorkingMessage("working", 7, markTheme, labels) === "<muted:D><muted:o><muted:i><muted:n><muted:g>", "shimmer rest after sweep failed");
	assert(renderWorkingMessage("working", 11, markTheme, labels) === renderWorkingMessage("working", 0, markTheme, labels), "shimmer should restart after rest");

	// Breathing glyph: one glyph, accent at the top of the breath, faded toward dim (never fully) at the bottom.
	const rgbTheme = {
		fg: (color, text) => `<${color}:${text}>`,
		getFgAnsi: (color) => color === "accent" ? "\x1b[38;2;200;100;0m" : "\x1b[38;2;100;100;100m",
		getColorMode: () => "truecolor",
	};
	const breath = createWorkingIndicatorFrames(rgbTheme);
	const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
	assert(breath.length === 24 && breath.every((frame) => strip(frame) === "○"), "breathing spinner should be 24 frames of the same glyph");
	assert(breath[0] === "\x1b[38;2;200;100;0m○\x1b[39m", "breath should start at the accent color");
	assert(breath[12] === "\x1b[38;2;115;100;85m○\x1b[39m", "breath bottom should fade 85% toward dim");
	assert(breath[4] === breath[20], "breath should be symmetric");
	const fallback = createWorkingIndicatorFrames({ fg: (color, text) => `<${color}:${text}>` });
	assert(fallback.length === 1 && fallback[0] === "<accent:○>", "unreadable theme colors should give a steady accent glyph");

	const renderedMessages = [];
	const ui = {
		setWorkingMessage(message) { renderedMessages.push(message); },
		setWorkingIndicator() {},
	};
	const controller = createWorkingLoaderController(ui, labels);
	controller.configure();
	assert(renderedMessages.at(-1) === "Doing", "configure should render initial working label");
	controller.start("thinking");
	assert(renderedMessages.at(-1) === "Pondering", "start should render requested thinking label");
	controller.setState("running");
	assert(renderedMessages.at(-1) === "Executing", "setState should render running label");
	controller.stop();
	controller.dispose();
	console.log("loader render smoke ok");
}

prepareWorkDir();
compileChangedSurface();

await runConfigSmoke("scaffold default object", undefined, ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "Cooking", "scaffold did not write default labels");
	assert(config.customWorkingMessage.thinking === "Thinking", "default config missing thinking label");
});

await runConfigSmoke("legacy true transforms", '{"customWorkingMessage":true}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "Cooking", "legacy true was not backfilled to labels");
	assert(config.customWorkingMessage.working === "Working", "legacy true did not normalize to labels");
});

await runConfigSmoke("legacy false transforms", '{"customWorkingMessage":false}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "Cooking", "legacy false was not backfilled to labels");
	assert(config.customWorkingMessage.answering === "Answering", "legacy false did not normalize to labels");
});

await runConfigSmoke("partial custom labels backfilled", '{"customWorkingMessage":{"running":"Executing","thinking":"Pondering"}}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "Executing", "custom running label was not preserved");
	assert(raw.customWorkingMessage?.working === "Working", "missing default label was not backfilled");
	assert(config.customWorkingMessage.thinking === "Pondering", "custom thinking label did not normalize");
});

await runConfigSmoke("inputBox.style scaffold default", undefined, ({ config, raw }) => {
	assert(raw.inputBox?.style === "auto", "scaffold did not write default inputBox.style");
	assert(config.inputBox.style === "auto", "default config missing inputBox.style");
});

await runConfigSmoke("inputBox.style custom halfblock", '{"inputBox":{"style":"halfblock"}}', ({ config, raw }) => {
	assert(raw.inputBox?.style === "halfblock", "custom halfblock style was not preserved");
	assert(config.inputBox.style === "halfblock", "custom halfblock style did not normalize");
});

await runConfigSmoke("inputBox.style custom line", '{"inputBox":{"style":"line"}}', ({ config, raw }) => {
	assert(raw.inputBox?.style === "line", "custom line style was not preserved");
	assert(config.inputBox.style === "line", "custom line style did not normalize");
});

await runConfigSmoke("inputBox.style custom solid", '{"inputBox":{"style":"solid"}}', ({ config, raw }) => {
	assert(raw.inputBox?.style === "solid", "custom solid style was not preserved");
	assert(config.inputBox.style === "solid", "custom solid style did not normalize");
});

await runConfigSmoke("inputBox.style invalid fallback", '{"inputBox":{"style":"invalid"}}', ({ config, raw }) => {
	assert(raw.inputBox?.style === "auto", "invalid style was not backfilled to auto");
	assert(config.inputBox.style === "auto", "invalid style did not fallback to default");
});

await runConfigSmoke("inputBox missing style field", '{"inputBox":{}}', ({ config, raw }) => {
	assert(raw.inputBox?.style === "auto", "missing style field was not backfilled");
	assert(config.inputBox.style === "auto", "missing style field did not normalize to default");
});

const brokenJson = '{"inputBox":{"style":"line"},}';
await runConfigSmoke("broken json moved aside", brokenJson, ({ config, raw }) => {
	const configDir = join(workDir, "home-broken-json-moved-aside", ".pi", "agent");
	const aside = readdirSync(configDir).filter((name) => name.startsWith("pi-droid-styling.json.invalid-"));
	assert(aside.length === 1 && readFileSync(join(configDir, aside[0]), "utf8") === `${brokenJson}\n`, "broken config was not preserved aside");
	assert(raw.customWorkingMessage?.running === "Cooking", "fresh default config was not scaffolded");
	assert(config.inputBox.style === "auto", "broken config should serve defaults");
});

await runLoaderSmoke();
console.log("working-message config smoke ok");
