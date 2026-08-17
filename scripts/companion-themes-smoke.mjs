#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "companion-themes-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "pi-stub.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
writeFileSync(stubPath, `declare module "@earendil-works/pi-coding-agent" {
	export interface ExtensionAPI { on(event: string, handler: (event: unknown, ctx: any) => unknown): void; }
}
`, "utf8");

if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install first");
const compile = spawnSync(process.execPath, [
	tsc,
	"--outDir", buildDir,
	"--rootDir", repoRoot,
	"--module", "NodeNext",
	"--moduleResolution", "NodeNext",
	"--target", "ES2022",
	"--skipLibCheck",
	"--noImplicitAny", "false",
	stubPath,
	"theme/companion-themes.ts",
], { cwd: repoRoot, encoding: "utf8" });
if (compile.status !== 0) {
	process.stderr.write(compile.stdout || "");
	process.stderr.write(compile.stderr || "");
	throw new Error(`TypeScript compile failed with code ${compile.status}`);
}

const builtThemesDir = join(buildDir, "node_modules", "pi-themes", "themes");
mkdirSync(join(buildDir, "node_modules", "pi-themes"), { recursive: true });
await import("node:fs/promises").then(({ cp }) => cp(join(repoRoot, "node_modules", "pi-themes", "themes"), builtThemesDir, { recursive: true }));

const { registerCompanionThemes } = await import(pathToFileURL(join(buildDir, "theme", "companion-themes.js")).href);
class InteractiveModeStub {
	async bindCurrentSessionExtensions() { this.bindCount = (this.bindCount ?? 0) + 1; }
}
let handler;
const pi = { on(event, nextHandler) { if (event === "resources_discover") handler = nextHandler; } };
registerCompanionThemes(pi, InteractiveModeStub);
const firstWrapper = InteractiveModeStub.prototype.bindCurrentSessionExtensions;
registerCompanionThemes(pi, InteractiveModeStub);
assert(InteractiveModeStub.prototype.bindCurrentSessionExtensions === firstWrapper, "reload must not stack the lifecycle wrapper");
assert(typeof handler === "function", "resources_discover handler should be registered");

const call = (existingNames) => handler({ type: "resources_discover", cwd: repoRoot, reason: "startup" }, {
	ui: { getAllThemes: () => existingNames.map((name) => ({ name, path: `/standalone/${name}.json` })) },
});
const mode = new InteractiveModeStub();
let reapplyCount = 0;
mode.themeController = { applyFromSettings: async () => { reapplyCount++; } };

const fresh = call([]).themePaths;
assert(fresh.length === 25, `fresh install should register 25 themes, got ${fresh.length}`);
const names = fresh.map((path) => JSON.parse(readFileSync(path, "utf8")).name);
assert(new Set(names).size === 25, "bundled theme names should be unique");
await mode.bindCurrentSessionExtensions();
assert(reapplyCount === 1, "fresh install should re-apply the selected theme after discovery");
await mode.bindCurrentSessionExtensions();
assert(reapplyCount === 1, "theme re-apply should happen only once per discovery");

assert(call(names).themePaths.length === 0, "standalone pi-themes should suppress every bundled duplicate");
await mode.bindCurrentSessionExtensions();
assert(reapplyCount === 1, "full standalone collection should not trigger theme re-apply");

const partial = call(names.slice(0, 7)).themePaths;
assert(partial.length === 18, `partial standalone collection should register 18 missing themes, got ${partial.length}`);
assert(partial.every((path) => !names.slice(0, 7).includes(JSON.parse(readFileSync(path, "utf8")).name)), "partial fallback should not return duplicate names");
await mode.bindCurrentSessionExtensions();
assert(reapplyCount === 2, "partial fallback should re-apply after missing themes are added");

const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assert(manifest.pi?.themes === undefined, "package manifest must not register bundled themes statically");
assert(manifest.bundledDependencies?.includes("pi-themes"), "pi-themes must remain bundled");
console.log("companion themes smoke ok: fresh=25 standalone=0 partial=18 reapply=2 reload-safe");
rmSync(workDir, { recursive: true, force: true });
