#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "user-zone-style-smoke");
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
	export const readdirSync: any;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
	export const statSync: (path: string) => { mtimeMs: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
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
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:os" {
	export const homedir: () => string;
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare module "node:child_process" {
	export const execFileSync: any;
	export const spawn: any;
	export const spawnSync: any;
}
declare module "child_process" {
	export const execFileSync: any;
	export const spawn: any;
	export const spawnSync: any;
}
declare const process: any;
declare type Buffer = any;
declare const Buffer: any;
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:user-zone-style");
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
		"user-zone/designs.ts",
		"config.ts",
		"editor/box-editor.ts",
		"fixed-zone/cluster.ts",
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

async function runStyleResolverSmoke() {
	const styles = await importBuilt("user-zone/designs.js");
	assert(styles.USER_ZONE_STYLE_NAMES.join(",") === "droid,gemini,cli-dock", "style names changed unexpectedly");
	assert(styles.resolveUserZoneStyle("droid").editor.showHostBorder === true, "droid style did not preserve host border");
	assert(styles.resolveUserZoneStyle("gemini").editor.layout === "gemini", "gemini style did not select gemini layout");
	assert(styles.resolveUserZoneStyle("gemini").editor.prompt === "❯", "gemini style did not keep droid prompt icon");
	assert(styles.resolveUserZoneStyle("gemini").editor.inputFrame === "auto", "gemini style should auto-select input framing");
	assert(styles.resolveUserZoneStyle("cli-dock").editor.layout === "cli-dock", "cli-dock style did not select Droid CLI layout");
	assert(styles.resolveUserZoneStyle("cli-dock").editor.prompt === "›", "cli-dock style did not use the Droid CLI prompt glyph");
	assert(styles.resolveUserZoneStyle("cli-dock").editor.inputFrame === "outline", "cli-dock style should use outline input framing by default");
	assert(styles.resolveUserZoneStyle(undefined).name === "gemini", "missing style did not resolve to gemini default");
	assert(styles.resolveUserZoneStyle("unknown").name === "droid", "unknown style did not resolve to droid fallback");
	assert(styles.resolveUserZoneStyle("toString").name === "droid", "inherited object key did not resolve to droid");
	console.log("style resolver smoke ok");
}

const INPUT_BACKGROUND_ANSI = "\x1b[48;2;100;107;56m";
const INPUT_BACKGROUND_AS_FG_ANSI = "\x1b[38;2;100;107;56m";
const WRONG_INPUT_BACKGROUND_FG_ANSI = "\x1b[38;2;200;10;10m";
const CURSOR_MARKER = "\x1b_pi:c\x07";

function makeTheme() {
	return {
		borderColor: (text) => text,
		selectList: {},
		fg: (color, text) => {
			if (color === "selectedBg") return `${WRONG_INPUT_BACKGROUND_FG_ANSI}${text}\x1b[39m`;
			if (color === "dim") return `\x1b[2m${text}\x1b[22m`;
			if (color === "borderMuted") return `\x1b[90m${text}\x1b[39m`;
			if (color === "muted") return `\x1b[37m${text}\x1b[39m`;
			if (color === "border") return `\x1b[34m${text}\x1b[39m`;
			if (color === "accent") return `\x1b[32m${text}\x1b[39m`;
			if (color === "thinkingText") return `\x1b[36m${text}\x1b[39m`;
			return text;
		},
		bg: (color, text) => color === "selectedBg" ? `${INPUT_BACKGROUND_ANSI}${text}\x1b[49m` : text,
		getBgAnsi: (color) => {
			if (color === "selectedBg") return INPUT_BACKGROUND_ANSI;
			throw new Error(`unknown background ${color}`);
		},
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
		inverse: (text) => text,
	};
}

async function runBoxEditorSmoke() {
	const { BoxEditor } = await importBuilt("editor/box-editor.js");
	const { resolveUserZoneStyle } = await importBuilt("user-zone/designs.js");
	const { setFullTheme } = await import(pathToFileURL(join(buildDir, "theme/theme-extras.js")).href);
	const promptThemePath = join(workDir, "prompt-color-theme.json");
	writeFileSync(promptThemePath, JSON.stringify({ extras: { bashPromptColor: "thinkingText", userPrefixColor: "accent" } }), "utf8");
	setFullTheme({ sourcePath: promptThemePath }, true);
	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const keybindings = { matches: () => false };
	const usage = () => ({ tokens: 12000, percent: 25, contextWindow: 48000 });
	const model = () => ({ provider: "openai", id: "gpt-test", name: "Deepseek V4 Flash", reasoning: true, thinkingLevel: "high" });
	const branch = () => ({ branch: "main", insertions: 2, deletions: 1 });
	const speed = () => 42;
	const footer = () => "ready";
	const cliDockFooter = () => "MCP ✓";

	const renderStyle = (styleName, raw = false, width = 88, footerProvider = footer, options = {}) => {
		const previousNoColor = process.env.NO_COLOR;
		if (options.noColor) process.env.NO_COLOR = "1";
		else delete process.env.NO_COLOR;

		try {
			const editor = new BoxEditor(
				tui,
				makeTheme(),
				keybindings,
				makeTheme(),
				"/tmp/pi-droid-style-smoke",
				usage,
				model,
				branch,
				speed,
				footerProvider,
				() => "footer",
				resolveUserZoneStyle(styleName),
				options.inputBoxStyle,
			);
			editor.setText(options.text ?? "hello");
			const rendered = editor.render(width);
			return raw ? rendered : rendered.map(stripAnsi);
		} finally {
			if (previousNoColor === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = previousNoColor;
		}
	};

	const droid = renderStyle("droid");
	const rawDroid = renderStyle("droid", true);
	const gemini = renderStyle("gemini");
	const rawGemini = renderStyle("gemini", true);
	const cliDock = renderStyle("cli-dock", false, 88, cliDockFooter);
		const rawCliDock = renderStyle("cli-dock", true, 88, cliDockFooter);
	const cliDockLineOverride = renderStyle("cli-dock", false, 88, cliDockFooter, { inputBoxStyle: "line" });
	const emptyCliDock = renderStyle("cli-dock", false, 88, cliDockFooter, { text: "" });
	const narrowGemini = renderStyle("gemini", false, 34, () => "very long status message for narrow terminal");
	const noColorGemini = renderStyle("gemini", false, 88, footer, { noColor: true });
	const rawNoColorGemini = renderStyle("gemini", true, 88, footer, { noColor: true });
	const geminiLine = renderStyle("gemini", false, 88, footer, { inputBoxStyle: "line" });
	const rawGeminiLine = renderStyle("gemini", true, 88, footer, { inputBoxStyle: "line" });
	const geminiSolid = renderStyle("gemini", false, 88, footer, { inputBoxStyle: "solid" });
	const rawGeminiSolid = renderStyle("gemini", true, 88, footer, { inputBoxStyle: "solid" });
	const droidLine = renderStyle("droid", false, 88, footer, { inputBoxStyle: "line" });
	const droidHalfblock = renderStyle("droid", false, 88, footer, { inputBoxStyle: "halfblock" });
	assert(droid.length === 6, `droid should preserve 6-row editor shell, got ${droid.length}`);
	assert(droid.some((line) => line.includes("== [")), "droid host border missing");
	assert(droid.some((line) => line.includes("[stat]")), "droid stat label missing");
	assert(gemini.length === 6, `gemini should render divider/status/padded-input/footer shell, got ${gemini.length}`);
	assert(cliDock.length === 4, `cli-dock should render outlined input plus one split status row, got ${cliDock.length}`);
	assert(!cliDock.some((line) => line.includes("Auto (Off)")), "cli-dock should not render approval status copy");
	assert(cliDock[0]?.startsWith("┌") && cliDock[0]?.endsWith("┐"), "cli-dock input should render a full-width outline top border without side padding");
	assert(cliDock[0]?.length === 88 && cliDock[1]?.length === 88 && cliDock[2]?.length === 88, "cli-dock outline should use the full container width");
	assert(rawCliDock[0]?.includes("\x1b[90m") && !rawCliDock[0]?.includes("\x1b[32m"), "cli-dock outline border should use muted border color instead of primary accent");
	assert(cliDock[1]?.startsWith("│") && cliDock[1]?.endsWith("│") && cliDock[1]?.includes("›") && cliDock[1]?.includes("hello"), "cli-dock input row should render prompt and text inside full-width outline borders");
	assert(cliDock[2]?.startsWith("└") && cliDock[2]?.endsWith("┘"), "cli-dock input should render a full-width outline bottom border without side padding");
	assert(cliDock[3]?.startsWith("  Deepseek V4 Flash \u00b7 high") && cliDock[3]?.endsWith("  ") && cliDock[3]?.length === 88 && !cliDock[3]?.includes("Model:"), "cli-dock status row should align with the input text instead of the outline edges and drop the Model label");
	assert(cliDock[3]?.includes("Deepseek V4 Flash \u00b7 high") && cliDock[3]?.includes("Ctx: 12k/48k") && cliDock[3]?.includes("🌿 main") && cliDock[3]?.includes("📁 pi-droid"), "cli-dock status row should show dynamic model with thinking level/context-window/branch/project on the left");
	assert(cliDock[3]?.includes("MCP ✓") && !cliDock[3]?.includes("⏱") && !cliDock[3]?.includes("? for help"), "cli-dock status row should show footer status on the right without elapsed/help chrome");
	assert((cliDock[3]?.indexOf("📁 pi-droid-style-smoke") ?? 0) < (cliDock[3]?.indexOf("MCP ✓") ?? 0), "cli-dock status row should split metadata left and MCP status right");
	assert(!cliDock.some((line) => line.includes("gpt-test (High)") || line.includes("Tokens:")), "cli-dock should not render legacy header or token label in the prompt dock");
	assert(cliDockLineOverride[0]?.includes("┌") && cliDockLineOverride[1]?.includes("│") && cliDockLineOverride[2]?.includes("└"), "cli-dock should keep a true outline box even when inputBox.style is line");
	assert(emptyCliDock[1]?.includes("Type a prompt or / for commands"), "cli-dock empty input should render the placeholder text");
	assert(gemini[0]?.replace(/─/g, "").trim() === "", "gemini divider should always be visible");
	assert(rawGemini[0]?.includes("\x1b[34m") && rawGemini[0]?.includes("\x1b[1m"), "gemini divider should use bold tool-box border color");
	const rawGeminiPromptLine = rawGemini.find((line) => stripAnsi(line).includes("❯"));
	assert(rawGeminiPromptLine?.includes("\x1b[32m❯") && !rawGeminiPromptLine?.includes("\x1b[36m❯"), "gemini input prompt should use user-prefix accent instead of bash prompt color");
	const rawDroidPromptLine = rawDroid.find((line) => stripAnsi(line).includes("❯"));
	assert(rawDroidPromptLine?.includes("\x1b[32m❯") && !rawDroidPromptLine?.includes("\x1b[36m❯"), "droid input prompt should use user-prefix accent instead of bash prompt color");
	assert(gemini[1]?.includes("main"), "gemini status row should put branch on the right");
	assert(gemini[1]?.includes("openai gpt-test · high"), "gemini status row should render compact provider model thinking level with subtle spacing");
	assert(!gemini[1]?.includes("[OPENAI]") && !gemini[1]?.includes("think:"), "gemini status row should avoid badge chrome and thinking label noise");
	assert(rawGemini[1]?.includes("\x1b[32m"), "gemini status row should use one accent color for thinking level");
	assert((gemini[1]?.indexOf("openai gpt-test · high") ?? -1) < (gemini[1]?.indexOf("12k") ?? -1), "gemini status row should put model before token stats");
	assert(gemini[1]?.includes("12k") && gemini[1]?.includes("25.0%/48k"), "gemini status row should preserve token stat formatting");
	assert(gemini[1]?.includes("│"), "gemini status row should separate token stats and model with a pipe");
	assert(!gemini[1]?.includes("[stat]"), "gemini status row should omit [stat] label");
	assert(!gemini[1]?.includes("Tokens:"), "gemini status row should omit the Tokens label");
	assert(gemini[2]?.includes("▄") && gemini[2]?.replace(/▄/g, "").trim() === "", "gemini input should render top half-line padding by default");
	assert(gemini[4]?.includes("▀") && gemini[4]?.replace(/▀/g, "").trim() === "", "gemini input should render bottom half-line padding by default");
	assert(rawGemini[2]?.includes(INPUT_BACKGROUND_AS_FG_ANSI), "gemini top half-line padding should match input background color");
	assert(rawGemini[3]?.includes(INPUT_BACKGROUND_ANSI), "gemini input row should use selected input background by default");
	assert(rawGemini[4]?.includes(INPUT_BACKGROUND_AS_FG_ANSI), "gemini bottom half-line padding should match input background color");
	assert(!rawGemini[2]?.includes(WRONG_INPUT_BACKGROUND_FG_ANSI) && !rawGemini[4]?.includes(WRONG_INPUT_BACKGROUND_FG_ANSI), "gemini half-line padding should convert selectedBg background to foreground instead of using fg(selectedBg)");
	assert(noColorGemini[2]?.includes("─") && noColorGemini[2]?.replace(/─/g, "").trim() === "", "NO_COLOR gemini input should fallback to top line border");
	assert(noColorGemini[4]?.includes("─") && noColorGemini[4]?.replace(/─/g, "").trim() === "", "NO_COLOR gemini input should fallback to bottom line border");
	assert(rawNoColorGemini[2]?.includes(INPUT_BACKGROUND_AS_FG_ANSI), "NO_COLOR gemini top input line border should use selected input background color");
	assert(!rawNoColorGemini[3]?.includes(INPUT_BACKGROUND_ANSI), "NO_COLOR gemini line-border input row should not use selected input background");
	assert(rawNoColorGemini[4]?.includes(INPUT_BACKGROUND_AS_FG_ANSI), "NO_COLOR gemini bottom input line border should use selected input background color");
	assert(geminiLine[2]?.includes("─") && geminiLine[2]?.replace(/─/g, "").trim() === "", "explicit gemini line input style should render top line border");
	assert(geminiLine[4]?.includes("─") && geminiLine[4]?.replace(/─/g, "").trim() === "", "explicit gemini line input style should render bottom line border");
	assert(!rawGeminiLine[3]?.includes(INPUT_BACKGROUND_ANSI), "explicit gemini line input row should not use selected input background");
	assert(geminiSolid.length === gemini.length - 1, `explicit gemini solid input style should remove the top padding row, got ${geminiSolid.length}`);
	assert(geminiSolid[2]?.includes("❯") && geminiSolid[2]?.includes("hello"), "explicit gemini solid input style should put the input row directly under the status row");
	assert(!geminiSolid[3]?.includes("▄") && !geminiSolid[3]?.includes("▀") && !geminiSolid[3]?.includes("─") && geminiSolid[3]?.trim() === "", "explicit gemini solid input style should render bottom full-background padding without glyph seams");
	assert(rawGeminiSolid[2]?.includes(INPUT_BACKGROUND_ANSI), "explicit gemini solid input row should use selected input background");
	assert(rawGeminiSolid[3]?.includes(INPUT_BACKGROUND_ANSI), "explicit gemini solid bottom padding should use selected input background");
	assert(droidLine.length === droid.length, `explicit droid line input style should keep default row count, got ${droidLine.length}`);
	assert(JSON.stringify(droidLine) === JSON.stringify(droid), "explicit droid line input style should keep the native droid input presentation");
	assert(droidHalfblock.length === 8, `explicit droid halfblock input style should add two frame rows, got ${droidHalfblock.length}`);
	assert(droidHalfblock[4]?.includes("▄") && droidHalfblock[4]?.replace(/▄/g, "").trim() === "", "explicit droid halfblock input style should render top half-line padding");
	assert(droidHalfblock[6]?.includes("▀") && droidHalfblock[6]?.replace(/▀/g, "").trim() === "", "explicit droid halfblock input style should render bottom half-line padding");
	assert(gemini[3]?.includes("❯") && gemini[3]?.includes("hello"), "gemini input row missing droid prompt icon or text");
	assert(!gemini.some((line) => /workspace|model|status/.test(line)), "gemini footer should not render column labels");
	assert(gemini[5]?.includes("pi-droid-style-smoke") && gemini[5]?.includes("ready"), "gemini footer values missing workspace/status");
	assert(gemini[5]?.trimEnd().endsWith("ready"), "gemini footer status value should align right");
	assert(!gemini[5]?.includes("gpt-test"), "gemini footer should not keep model column after model moves to status row");
	assert(rawGemini[5]?.includes("\x1b[2m"), "gemini footer values should use dim text");
	assert(narrowGemini.length === gemini.length, "gemini narrow footer should keep the right cluster on one line instead of wrapping");
	assert(narrowGemini[5]?.trimEnd().endsWith("…"), "gemini narrow footer right cluster should be truncated at the right edge, not clipped by panel padding");
	assert(narrowGemini.every((line) => stripAnsi(line).length <= 34), "gemini narrow layout should not overflow terminal width");
	assert(!gemini.some((line) => line.includes("== [")), "gemini should hide host border");
	assert(!gemini.some((line) => /sandbox|quota/i.test(line)), "gemini should not render sandbox/quota columns");
	console.log("box editor style smoke ok");
}

async function runFixedZoneSmoke() {
	const { renderFixedUserZoneCluster } = await importBuilt("fixed-zone/cluster.js");
	const directGeminiCluster = renderFixedUserZoneCluster([{
		target: { render: () => [] },
		render: (width) => [
			`${CURSOR_MARKER}${INPUT_BACKGROUND_ANSI}${"editor".padEnd(width)}\x1b[49m`,
			`${"workspace".padEnd(width - "ready".length)}ready`,
		],
	}], 60, 4, { scrollHint: "^Alt T TOP", hintRightInset: 0, scrollHintPlacement: "lastLine" });
	assert(!stripAnsi(directGeminiCluster.lines[0] ?? "").includes("^Alt"), "gemini shortcut hint should not stay inside input row");
	const directFooterLine = stripAnsi(directGeminiCluster.lines[1] ?? "").trimEnd();
	assert(directFooterLine.endsWith("ready  [^Alt T TOP]"), "gemini shortcut hint should append after footer status without replacing it");

	const workspaceOnlyCluster = renderFixedUserZoneCluster([{
		target: { render: () => [] },
		render: (width) => [
			`${CURSOR_MARKER}${INPUT_BACKGROUND_ANSI}${"editor".padEnd(width)}\x1b[49m`,
			"workspace".padEnd(width),
		],
	}], 60, 4, { scrollHint: "^Alt T TOP", hintRightInset: 0, scrollHintPlacement: "lastLine" });
	const workspaceOnlyFooter = stripAnsi(workspaceOnlyCluster.lines[1] ?? "");
	const workspaceEnd = workspaceOnlyFooter.indexOf("workspace") + "workspace".length;
	const hintStart = workspaceOnlyFooter.indexOf("[^Alt T TOP]");
	assert(hintStart > workspaceEnd + 2, "gemini shortcut hint should stay right-aligned when footer status is empty");
	assert(workspaceOnlyFooter.endsWith("[^Alt T TOP]"), "gemini shortcut hint should not leave trailing spacing");
	console.log("fixed-zone style smoke ok");
}

prepareWorkDir();
compileChangedSurface();

await runConfigSmoke("scaffold default style", undefined, ({ config, raw }) => {
	assert(raw.userZoneStyle === "gemini", "scaffold did not write default userZoneStyle");
	assert(config.userZoneStyle === "gemini", "default config did not normalize to gemini");
});

await runConfigSmoke("valid style preserved", '{"userZoneStyle":"gemini"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "gemini", "valid userZoneStyle was not preserved");
	assert(config.userZoneStyle === "gemini", "valid userZoneStyle did not normalize");
});

await runConfigSmoke("cli-dock style preserved", '{"userZoneStyle":"cli-dock"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "cli-dock", "cli-dock userZoneStyle was not preserved");
	assert(config.userZoneStyle === "cli-dock", "cli-dock userZoneStyle did not normalize");
});

await runConfigSmoke("unknown string style preserved on disk", '{"userZoneStyle":"ghost"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "ghost", "unknown string userZoneStyle should be preserved on disk");
	assert(config.userZoneStyle === "droid", "unknown string userZoneStyle should normalize to droid at runtime");
});

await runConfigSmoke("non-string style backfilled", '{"userZoneStyle":42}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "droid", "non-string userZoneStyle was not backfilled to droid");
	assert(config.userZoneStyle === "droid", "non-string userZoneStyle did not normalize to droid");
});

await runConfigSmoke("scaffold excludes fixedUserZone", undefined, ({ config, raw }) => {
	assert(!("fixedUserZone" in raw), "fresh scaffold should not write fixedUserZone");
	assert(!("fixedUserZone" in config), "normalized config should not expose fixedUserZone");
});

await runConfigSmoke("legacy fixedUserZone removed", '{"fixedUserZone":true,"userZoneStyle":"gemini"}', ({ config, raw }) => {
	assert(!("fixedUserZone" in raw), "legacy fixedUserZone:true should be deleted from disk");
	assert(!("fixedUserZone" in config), "normalized config should not expose fixedUserZone");
	assert(raw.userZoneStyle === "gemini", "other keys preserved during migration");
	assert(config.userZoneStyle === "gemini", "migrated config still normalizes userZoneStyle");
});

await runStyleResolverSmoke();
await runBoxEditorSmoke();
await runFixedZoneSmoke();
console.log("user-zone style smoke ok");
