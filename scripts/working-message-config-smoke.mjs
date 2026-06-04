#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	const { loadConfig } = await importBuilt("config.js");
	const config = loadConfig();
	const raw = JSON.parse(readFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), "utf8"));
	validate({ config, raw });
	console.log(`config smoke ok: ${name}`);
}

async function runLoaderSmoke() {
	const { renderWorkingMessage } = await importBuilt("tool-tags/loader-accent.js");
	const labels = { working: "Doing", thinking: "Pondering", answering: "Replying", running: "Executing" };
	assert(renderWorkingMessage("running", 0, undefined, labels) === "Executing.", "custom running render failed");
	assert(renderWorkingMessage("thinking", 1, undefined, labels) === "Pondering..", "custom thinking render failed");
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

await runLoaderSmoke();
console.log("working-message config smoke ok");
