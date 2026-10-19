// Shared by the conversation smokes: compile TS entries (and what they import) to plain ESM under
// .pi/<name>/build, with loose Node typings (the repo carries no @types/node).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STUBS = `${["fs", "path", "os", "url", "buffer", "perf_hooks", "child_process"]
	.flatMap((name) => [name, `node:${name}`])
	.map((name) => `declare module "${name}";`)
	.join("\n")}
declare const process: any;
declare const setTimeout: any;
declare const clearTimeout: any;
declare const setInterval: any;
declare const clearInterval: any;
`;

/** Returns `{ workDir, buildDir, importBuilt(relativeJsPath) }`; the caller removes workDir when done. */
export function buildSmoke(name, entries, repoRoot = process.cwd()) {
	const workDir = join(repoRoot, ".pi", name);
	const buildDir = join(workDir, "build");
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
	// loadConfig() scaffolds ~/.pi/agent/pi-droid-styling.json; built modules must never see the real home.
	const home = join(workDir, "home");
	mkdirSync(home, { recursive: true });
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	const stubPath = join(workDir, "node-stubs.d.ts");
	writeFileSync(stubPath, STUBS, "utf8");
	const result = spawnSync(process.execPath, [
		join(repoRoot, "node_modules", "typescript", "lib", "tsc.js"),
		"--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
		"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
		stubPath, ...entries.map((entry) => join(repoRoot, entry)),
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`tsc failed\n${result.stdout}\n${result.stderr}`);
	let imports = 0;
	const urlOf = (relativePath) => new URL(`file://${join(buildDir, relativePath)}`).href;
	return {
		workDir,
		buildDir,
		/** The module instance the built files import each other through. */
		importBuilt: (relativePath) => import(urlOf(relativePath)),
		/** A private module instance (cache-busting query), so module-level state cannot leak between cases. */
		importFresh: (relativePath) => import(`${urlOf(relativePath)}?instance=${imports++}`),
	};
}
