#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "nvim-user-zone-smoke");
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

function range(from, to) {
	const out = [];
	for (let i = from; i <= to; i++) out.push(i);
	return out;
}

// Property 1 -- line integrity. The bar must truncate on PLAIN text only and colour last; a coloured
// string handed to the ANSI truncator injects a full \x1b[0m reset that clears the bar's selectedBg
// for the rest of the row. Width is measured with pi-tui's own visibleWidth, not .length (a CJK or
// emoji fixture has fewer display columns than UTF-16 code units, so .length would silently pass a
// mis-sized row). Kept deliberately separate from status-retention (below) so a red run points at the
// truncator/allocator, not a vague mix of the two.
function assertLineIntegrity(raw, width, label) {
	assert(!raw.includes("\x1b[0m"), `${label}: nvim bar must never emit a full \\x1b[0m reset (it would clear selectedBg)`);
	const displayWidth = visibleWidth(stripAnsi(raw));
	assert(displayWidth === width, `${label}: nvim bar should occupy the full terminal display width ${width}, got ${displayWidth}`);
}

// Property 2 support -- count a sentinel grapheme surviving at the tail of the bar, excluding the
// ellipsis. The sentinel is a single repeated character that never appears in the badge/model/chrome
// text, so any contiguous run of it at the tail is -- because every repetition is byte-identical --
// necessarily a genuine PREFIX of the full status, never a truncation fragment; no separate
// "prefix is correct" check is needed beyond finding a contiguous run anchored at the end of string.
function countSentinelTail(plainBar, sentinel) {
	const trimmed = plainBar.replace(/ +$/, "");
	const escaped = sentinel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = trimmed.match(new RegExp(`((?:${escaped})+)(\u2026)?$`, "u"));
	if (!match) return { count: 0, hasEllipsis: trimmed.endsWith("\u2026") };
	return { count: Array.from(match[1]).length, hasEllipsis: Boolean(match[2]) };
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
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:nvim-user-zone");
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
	assert(styles.resolveUserZoneStyle("nvim").editor.layout === "nvim", "nvim style did not select the nvim layout");
	assert(styles.resolveUserZoneStyle("nvim").editor.inputFrame === "line", "nvim style should default to the line input frame");
	assert(styles.resolveUserZoneStyle("nvim").editor.placeholder === "Type a prompt  \u00b7  / commands  \u00b7  ! bash", "nvim placeholder text changed unexpectedly");
	assert(styles.resolveUserZoneStyle("nvim").editor.inputBackgroundColor === "selectedBg", "nvim statusline bar should use the selectedBg token");
	console.log("nvim style resolver smoke ok");
}

const COLOR_ANSI = {
	dim: "\x1b[2m",
	muted: "\x1b[37m",
	accent: "\x1b[32m",
	success: "\x1b[92m",
	warning: "\x1b[33m",
	error: "\x1b[31m",
	bashMode: "\x1b[35m",
	selectedBg: "\x1b[46m",
};

function makeTheme() {
	return {
		borderColor: (text) => text,
		selectList: {},
		fg: (color, text) => `${COLOR_ANSI[color] ?? ""}${text}\x1b[39m`,
		bg: (color, text) => color === "selectedBg" ? `${COLOR_ANSI.selectedBg}${text}\x1b[49m` : text,
		getBgAnsi: (color) => color === "selectedBg" ? COLOR_ANSI.selectedBg : "",
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
		inverse: (text) => text,
		// The nvim badge is coloured by MODE (accent for normal input, bashMode for `!`), never by
		// thinking level -- thinkingBorderColor tokens are tuned for a thin border line and every
		// theme keeps them deliberately desaturated, so a solid block would render as a muddy slab.
		// This trap fails loudly if the badge ever calls getThinkingBorderColor again.
		getThinkingBorderColor: () => { throw new Error("nvim badge must not call getThinkingBorderColor; colour comes from mode (accent/bashMode), not thinking level"); },
		getBashModeBorderColor: () => (text) => `${COLOR_ANSI.bashMode}${text}\x1b[39m`,
	};
}

const NVIM_TOKENS = ["dim", "muted", "accent", "success", "warning", "error", "bashMode", "selectedBg"];

async function runNvimStatuslineSmoke() {
	const { BoxEditor } = await importBuilt("editor/box-editor.js");
	const { resolveUserZoneStyle } = await importBuilt("user-zone/designs.js");

	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const keybindings = { matches: () => false };
	const usage = () => ({ tokens: 84000, percent: 42.4, contextWindow: 200000 });
	const model = () => ({ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", reasoning: true, thinkingLevel: "high" });
	const branch = () => ({ branch: "main", insertions: 2, deletions: 1 });
	const speed = () => 42;
	const tokenUsage = () => "[\u21911.2k \u21930.5k R2.1k CH91.0%]";

	const makeEditor = (options = {}) => {
		const editor = new BoxEditor(
			tui,
			makeTheme(),
			keybindings,
			makeTheme(),
			"/tmp/pi-droid-nvim-smoke",
			usage,
			options.model ?? model,
			branch,
			speed,
			options.footer ?? (() => ""),
			() => "footer",
			resolveUserZoneStyle("nvim"),
			options.inputBoxStyle,
			options.tokenUsage ?? tokenUsage,
		);
		editor.setText(options.text ?? "");
		if (options.autocomplete) {
			// The base editor and this preset's own renderSlashAutocomplete() override both read these
			// exact fields at runtime; there is no public constructor hook for it.
			editor.autocompleteState = {};
			editor.autocompleteList = options.autocomplete;
		}
		return editor;
	};

	const render = (width, options = {}) => {
		const rendered = makeEditor(options).render(width);
		return options.raw ? rendered : rendered.map(stripAnsi);
	};

	// Call the statusline renderer DIRECTLY (it is a normal method at runtime -- TS `private` has no
	// runtime effect), per Biscuit's approach (a): this sidesteps row-location entirely for every
	// content assertion, so it is correct regardless of `inputFrame`. Only `locateNvimBar` (below) still
	// needs to search rows, and only for the row-shape/autocomplete assertions that genuinely need the
	// surrounding rows.
	function bar(width, options = {}) {
		const raw = makeEditor(options).renderNvimStatusline(width);
		return { raw, plain: stripAnsi(raw) };
	}

	// Locate the nvim statusline bar by its `selectedBg` background wrapper. This is NOT a globally unique
	// marker -- `renderInputBoxFrame` also calls `this.bg(inputBackgroundColor, ...)` for the `solid` and
	// `halfblock` input frames (verified in code: `:640-644`), so a render using either of those frames
	// would carry the same marker on more than one row. It IS unique here because every render() call in
	// this suite keeps `inputFrame` at the nvim preset's default of `line` (the only override tested is
	// `outline`, which also never calls `this.bg`); the marker is also NOT the badge's reverse-video escape
	// (\x1b[7m...\x1b[27m), which is unsafe even for `line`/`outline` because the input box's own text
	// cursor renders with the same escapes, so a render with both a badge and a visible cursor would carry
	// it on two different rows -- verified against real compiled output, not assumed from the badge's name.
	function locateNvimBar(rows) {
		const marker = COLOR_ANSI.selectedBg;
		const matches = [];
		rows.forEach((row, index) => { if (row.includes(marker)) matches.push(index); });
		assert(
			matches.length === 1,
			`expected exactly one row carrying the nvim statusline's selectedBg wrapper, got ${matches.length}: ${JSON.stringify(rows.map(stripAnsi))}`,
		);
		return { index: matches[0], row: rows[matches[0]] };
	}

	// Full-row variant of `bar()`, used only where the row-shape/position itself is under test.
	function renderBar(width, options = {}) {
		const rows = render(width, { ...options, raw: true });
		const { index, row } = locateNvimBar(rows);
		return { raw: row, plain: stripAnsi(row), index, rows };
	}

	// Row shape: input frame (line + line + line) + statusline bar. Row count never changes
	// (no second row for extension status) whether or not a status is present.
	const empty = render(100);
	assert(empty.length === 4, `nvim should always render 4 rows, got ${empty.length}`);
	assert(empty[0].replace(/\u2500/g, "").trim() === "" && empty[0].length === 100, "nvim top border should be a full-width line rule");
	assert(empty[2].replace(/\u2500/g, "").trim() === "" && empty[2].length === 100, "nvim bottom border should be a full-width line rule");
	const emptyBar = renderBar(100);
	assert(emptyBar.index === 3, `nvim statusline should be row 3 for a single-line, autocomplete-free render, got row ${emptyBar.index}`);
	assert(emptyBar.plain.includes("HIGH"), "nvim statusline should render the badge on the bar row");
	const withStatusRowCount = render(100, { footer: () => "MCP: 2 servers connected" }).length;
	assert(withStatusRowCount === empty.length, `nvim row count should not change when an extension status is present, got ${withStatusRowCount} vs ${empty.length}`);

	// Placeholder shown while empty, gone after first keystroke, byte-identical text sourced from preset data.
	assert(empty[1].includes("Type a prompt  \u00b7  / commands  \u00b7  ! bash"), "nvim placeholder text missing while buffer is empty");
	const afterKeystroke = render(100, { text: "x" });
	assert(!afterKeystroke[1].includes("Type a prompt"), "nvim placeholder should disappear after the first keystroke");

	// Extension status: appended to the SAME bar row, far right, only when non-empty. Never a second row.
	const withStatus = render(100, { footer: () => "MCP: 2 servers connected" });
	assert(withStatus.length === 4, "nvim must stay one bar row even with a non-empty extension status");
	const withStatusBar = bar(100, { footer: () => "MCP: 2 servers connected" });
	assert(withStatusBar.plain.trimEnd().endsWith("MCP: 2 servers connected") && withStatusBar.plain.length === 100, "nvim bar should append the extension status at the far right of the same row");
	const withoutStatus = render(100, { footer: () => "" });
	assert(withoutStatus.length === 4 && !withoutStatus[3].includes("MCP"), "nvim should not append anything when the extension status is empty");
	// Long status truncates with … instead of wrapping onto another row (renderGeminiFooter convention)
	// AND keeps a live payload before the ellipsis -- an implementation that silently drops the status
	// (or collapses it to a lone …) must fail loudly instead of passing on row-count/length alone.
	const longStatusRows = render(100, { footer: () => "A".repeat(200), raw: true });
	assert(longStatusRows.length === 4, "nvim must not wrap a long extension status onto a second row");
	const longStatusBar = bar(100, { footer: () => "A".repeat(200) });
	assertLineIntegrity(longStatusBar.raw, 100, "long status");
	assert(longStatusBar.plain.trimEnd().includes("A"), "truncated long status must keep visible payload before the ellipsis, not be dropped");

	// Exactly one chrome bar; no value duplicated across the zone's rows.
	const plainBlock = empty.join("\n");
	assert((plainBlock.match(/claude-sonnet-4/g) ?? []).length === 1, "nvim should not render the model id twice");
	assert((plainBlock.match(/\u2387 main/g) ?? []).length === 1, "nvim should not render the branch twice");
	assert((plainBlock.match(/42%/g) ?? []).length === 1, "nvim should not render the context percent twice");
	assert((plainBlock.match(/CH 91%/g) ?? []).length === 1, "nvim should not render the cache-hit percent twice");

	// Cache-hit contract: getFooterTokenUsage's existing bracket string is the only source, pinned so a format
	// change fails loudly instead of silently dropping CH% off the bar.
	assert(bar(100).plain.includes("CH 91%"), "nvim bar should extract CH91.0% from getFooterTokenUsage as 'CH 91%'");
	const noChTokenUsage = () => "[\u21911.2k \u21930.5k R2.1k]";
	assert(!bar(100, { tokenUsage: noChTokenUsage }).plain.includes("CH "), "nvim bar should omit the CH segment when the source string has no CH value");
	const ch100 = () => "[\u21911.2k \u21930.5k R2.1k CH100.0%]";
	assert(bar(100, { tokenUsage: ch100 }).plain.includes("CH 100%"), "nvim bar should render CH100.0% as 'CH 100%'");
	const ch0 = () => "[\u21911.2k \u21930.5k R2.1k CH0.0%]";
	assert(bar(100, { tokenUsage: ch0 }).plain.includes("CH 0%"), "nvim bar should render CH0.0% as 'CH 0%'");

	// Badge label + colour: level uppercase verbatim (Pi's own six levels only), BASH overrides level,
	// no badge at all for non-reasoning models (including reasoning: undefined) -- never an invented label.
	// Colour is by MODE, not by level: all six thinking levels share the exact same `accent` colour
	// (only the label text differs), and `!` switches to `bashMode`. `accent` is the theme's own general
	// highlight token, so a theme author retuning it deliberately carries every accented UI element --
	// including this badge -- along with it; measured alternatives (syntaxNumber, syntaxType) scored
	// better on raw contrast/distinctness numbers but borrow meaning from an unrelated part of the theme
	// (syntax highlighting), so the badge stops feeling like the theme's own chrome. Known, accepted, not
	// a bug: in 5/26 companion themes `accent === bashMode`, so entering bash mode there changes only the
	// `BASH` label, not the colour -- do not special-case those themes or invent an off-palette colour.
	// getThinkingBorderColor must never be called at all -- the mock throws if it is, turning a silent
	// regression into a hard failure. Colour checks are scoped to the badge block itself (between the
	// reverse-video toggles) for robustness even though nothing else in the row currently uses
	// accent/bashMode.
	const extractBadge = (raw) => raw.match(/\x1b\[7m([\s\S]*?)\x1b\[27m/)?.[1] ?? "";
	const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
	for (const level of LEVELS) {
		const levelModel = () => ({ provider: "anthropic", id: "claude-sonnet-4", reasoning: true, thinkingLevel: level });
		const b = bar(100, { model: levelModel });
		const badge = extractBadge(b.raw);
		assert(b.plain.includes(level.toUpperCase()), `nvim badge should show ${level.toUpperCase()} for thinkingLevel ${level}`);
		assert(badge.includes(COLOR_ANSI.accent), `nvim badge for ${level} should use the accent token (mode colour, not a level ramp)`);
		assert(!badge.includes(COLOR_ANSI.bashMode), `nvim badge for ${level} should not use the bashMode colour outside bash mode`);
	}
	const bashBar = bar(100, { text: "!ls -la" });
	const bashBadge = extractBadge(bashBar.raw);
	assert(bashBar.plain.includes("BASH"), "nvim badge should show BASH while the input starts with !");
	assert(bashBadge.includes(COLOR_ANSI.bashMode) && !bashBadge.includes(COLOR_ANSI.accent), "nvim BASH badge should use the bashMode colour, not accent");
	// Bash-mode boundaries: the bang must be the first non-whitespace character of the buffer. A
	// leading newline/whitespace still counts (trimStart), but only-whitespace or a bang embedded
	// mid-line must NOT trigger bash mode.
	const bashPlain = (text) => bar(100, { text }).plain;
	assert(bashPlain("   ").includes("HIGH") && !bashPlain("   ").includes("BASH"), "nvim should not enter bash mode for whitespace-only input");
	assert(bashPlain("\n!ls").includes("BASH"), "nvim should enter bash mode when a leading newline precedes the bang");
	assert(bashPlain("echo hi; !ls").includes("HIGH") && !bashPlain("echo hi; !ls").includes("BASH"), "nvim should not enter bash mode when the bang is not the first non-whitespace character");
	// ANSI assertions must run on the RAW string; render() without raw already strips ANSI, so an ANSI
	// check on its output would be a tautology.
	const noBadgeModel = () => ({ provider: "openai", id: "gpt-4o", reasoning: false });
	const noBadgeBar = bar(100, { model: noBadgeModel });
	assertLineIntegrity(noBadgeBar.raw, 100, "non-reasoning model");
	assert(!noBadgeBar.raw.includes("\x1b[7m") && noBadgeBar.plain.startsWith("openai"), "nvim should render no badge at all for a non-reasoning model; the bar starts with the model identity");
	const undefinedReasoningPlain = bar(100, { model: () => ({ provider: "openai", id: "gpt-4o" }) }).plain;
	assert(undefinedReasoningPlain.startsWith("openai"), "nvim should render no badge when reasoning is undefined, matching today's suffix gate");
	for (const level of LEVELS) {
		const levelModel = () => ({ provider: "anthropic", id: "claude-sonnet-4", reasoning: true, thinkingLevel: level });
		assert(!bar(100, { model: levelModel }).plain.includes("NORMAL"), "nvim must never render an invented NORMAL label");
	}

	// Property 1 -- line integrity, scanned across width x model-length x status, for ASCII, CJK, and
	// emoji fixtures in both the model id and the extension status. This is the regression biscuit found
	// (safeTruncateToWidth on a coloured string injects \x1b[0m) plus the widened finding that pi-tui's
	// truncator injects that reset even on PLAIN Unicode/CJK/emoji input, so any code path that truncates
	// plain text must go through a helper proven to strip it back out.
	const integrityModels = [
		{ label: "ASCII model", provider: "anthropic", id: "claude-sonnet-4" },
		{ label: "150-char ASCII model id", provider: "openrouter", id: "A".repeat(150) },
		{ label: "CJK model id", provider: "openrouter", id: "\u6a21\u578b\u8b58\u5225\u78bc".repeat(20) },
		{ label: "emoji model id", provider: "openrouter", id: "\ud83d\ude80".repeat(60) },
	];
	const integrityStatuses = [
		{ label: "no status", footer: () => "" },
		{ label: "ASCII status", footer: () => "MCP: 2 servers connected" },
		{ label: "long ASCII status", footer: () => "A".repeat(300) },
	];
	for (const width of range(1, 200)) {
		for (const m of integrityModels) {
			for (const s of integrityStatuses) {
				const b = bar(width, { model: () => ({ provider: m.provider, id: m.id, reasoning: true, thinkingLevel: "high" }), footer: s.footer });
				assertLineIntegrity(b.raw, width, `width ${width} / ${m.label} / ${s.label}`);
			}
		}
		// CJK/emoji status is checked against the default short model to keep the scan proportionate
		// while still exercising the same plain-truncation path on the status side.
		for (const statusLabel of ["CJK status", "emoji status"]) {
			const footer = statusLabel === "CJK status"
				? () => "\u72c0\u614b\u4f3a\u670d\u5668\u9023\u7dda\u6b63\u5e38\u904b\u4f5c\u4e2d".repeat(5)
				: () => "\ud83d\ude80".repeat(80);
			const b = bar(width, { footer });
			assertLineIntegrity(b.raw, width, `width ${width} / default model / ${statusLabel}`);
		}
		// Missing model.id: `id` is optional on the model-info type, so this branch is real even though
		// a live model almost always has one. Without the earlier fix this pinned width 6 at every width.
		const missingIdBar = bar(width, { model: () => ({ provider: "anthropic", reasoning: true, thinkingLevel: "high" }) });
		assertLineIntegrity(missingIdBar.raw, width, `width ${width} / missing model.id`);
	}
	// Bash-mode recompose: the bash badge is coloured with bashMode (not accent), and truncating a
	// long model id under a bash input must keep that colour and never inject \x1b[0m at any width.
	for (const width of range(1, 200)) {
		const b = bar(width, { model: () => ({ provider: "openrouter", id: "A".repeat(150), reasoning: true, thinkingLevel: "high" }), text: "!ls" });
		assertLineIntegrity(b.raw, width, `bash recompose width ${width}`);
	}
	const bashRecomposeBlock = extractBadge(bar(16, { model: () => ({ provider: "openrouter", id: "A".repeat(150), reasoning: true, thinkingLevel: "high" }), text: "!ls" }).raw);
	assert(bashRecomposeBlock.includes(COLOR_ANSI.bashMode) && !bashRecomposeBlock.includes(COLOR_ANSI.accent), "bash recompose must keep the bashMode badge colour, not accent");
	// Reverse-video toggle is present when the badge renders (not a full reset).
	const badgeToggleRaw = bar(100).raw;
	assert(badgeToggleRaw.includes("\x1b[7m") && badgeToggleRaw.includes("\x1b[27m"), "nvim badge should toggle reverse video with \x1b[7m/\x1b[27m, not a full reset");

	// Property 2 -- status retention is monotonic, run as a TRUE cross product of model x status script
	// (Biscuit's coverage-seam finding: retention was previously only asserted against the default short
	// model, while the long/CJK model fixtures existed in Property 1 but were never asserted for retention
	// -- a fixture that exists somewhere is not the same as a fixture wired into the property that needs
	// it). See countSentinelTail's doc comment for why a repeated-sentinel fixture makes "the surviving
	// prefix is correct" free to verify; the sentinels are chosen to never collide with any literal in the
	// model/provider/badge/chrome text used here. This is the exact regression class Biscuit found: an
	// over-long model id budgeted the status off its own untruncated width and starved it to 0 -- fixed by
	// hard-capping the id itself at source (NVIM_MODEL_ID_MAX, see box-editor.ts), which bounds the left
	// cluster's actual width by construction instead of clamping only the scoring side (that was tried and
	// reverted: it fixed the status side but broke chrome monotonicity below).
	const retentionModels = [
		{ label: "short model", provider: "anthropic", id: "claude-sonnet-4", overCap: false },
		{ label: "ASCII 150 model id", provider: "openrouter", id: "A".repeat(150), overCap: true },
		{ label: "CJK model id", provider: "openrouter", id: "\u6a21\u578b\u8b58\u5225\u78bc".repeat(20), overCap: true },
	];
	const sentinelFixtures = [
		{ label: "ASCII sentinel", sentinel: "S", n: 30 },
		{ label: "CJK sentinel", sentinel: "\u72c0", n: 30 },
		{ label: "emoji sentinel", sentinel: "\ud83d\ude80", n: 30 },
	];
	for (const m of retentionModels) {
		const modelFn = () => ({ provider: m.provider, id: m.id, reasoning: true, thinkingLevel: "high" });
		for (const { label, sentinel, n } of sentinelFixtures) {
			const status = sentinel.repeat(n);
			let prevCount = -1;
			for (const width of range(1, 200)) {
				const { plain } = bar(width, { model: modelFn, footer: () => status });
				// An over-cap model id always ends in the id-cap ellipsis (NVIM_MODEL_ID_MAX), so a trailing
				// ellipsis is the MODEL's cap marker, not the status truncation marker this law is about: strip
				// the trailing ellipsis (a suffix strip, not an exact-marker check -- the capped tail's exact
				// content is pinned separately by Property 4) before the law fires; the law then proves no
				// second ellipsis remains.
				const lawPlain = m.overCap && plain.trimEnd().endsWith("\u2026") ? plain.trimEnd().slice(0, -1) : plain;
				const { count, hasEllipsis } = countSentinelTail(lawPlain, sentinel);
				const full = countSentinelTail(plain, sentinel);
				assert(full.count >= prevCount, `${m.label} / ${label} width ${width}: status retention must be monotonic, got ${full.count} sentinels after ${prevCount} at a narrower width`);
				if (count === 0) assert(!hasEllipsis, `${m.label} / ${label} width ${width}: status fully dropped but the row still shows a trailing ellipsis (bare "\u2026")`);
				prevCount = Math.max(prevCount, full.count);
			}
			assert(prevCount === n, `${m.label} / ${label}: status should reach its full ${n} sentinels by width 200, got ${prevCount}`);
		}
	}

	// Property 3 -- chrome never regresses as the bar widens, independent of Property 2's status-side
	// check. Verified independently by Mark on the pre-existing algorithm (0 violations); pinned here as a
	// permanent regression test because a first attempt at the status-starvation fix (switching between two
	// avail formulas at a width-dependent threshold) broke this exact property -- reproduced against a
	// rebuilt pre-fix baseline, root-caused to the width-dependent switch, and reverted in favour of the
	// single-formula cap in box-editor.ts, which this property now guards going forward.
	const chromeFixtures = [
		{ label: "no status", footer: () => "" },
		{ label: "short status", footer: () => "MCP: 2 servers connected" },
		{ label: "long sentinel status", footer: () => "S".repeat(30) },
	];
	for (const m of retentionModels) {
		const modelFn = () => ({ provider: m.provider, id: m.id, reasoning: true, thinkingLevel: "high" });
		for (const { label, footer } of chromeFixtures) {
			// `provider` joins the seen-flags: once the provider name has been shown, widening must
			// never silently remove it again (cheap -- reuses the exact loop Biscuit already made us write).
			const seen = { branch: false, tokens: false, ctx: false, ch: false, provider: false };
			for (const width of range(20, 140)) {
				const { plain } = bar(width, { model: modelFn, footer });
				const now = {
					branch: plain.includes("\u2387 main"),
					tokens: /\d+k\/\d+k/.test(plain),
					ctx: plain.includes("42%"),
					ch: /CH \d+%/.test(plain),
					provider: plain.includes(m.provider),
				};
				for (const key of Object.keys(seen)) {
					assert(!seen[key] || now[key], `${m.label} / ${label} width ${width}: chrome element '${key}' disappeared after being shown at a narrower width`);
					seen[key] = seen[key] || now[key];
				}
			}
		}
	}

	// Property 4 -- model-id retention is monotonic in width. The model id is the left cluster's core
	// identity: once the bar has shown N characters of it, widening must show >= N. This went red FIRST
	// against the pre-fix allocator (drops at w54/72/86/104 for the A-x150 fixture: the with-provider rung
	// switched on and silently stole columns from the model) and is the regression net for the fix: the id
	// is hard-capped at source (NVIM_MODEL_ID_MAX, see box-editor.ts), so EVERY rung that shows the model
	// shows the same capped id and no rung switch can shrink it. Sentinel run counted like Property 2's;
	// the A and 模 sentinels appear in no other fixture text (badge, status scripts, chrome).
	const modelRetentionFixtures = [
		{ label: "ASCII 150 model id", id: "A".repeat(150), sentinel: "A", reaches: 39 },
		{ label: "CJK model id", id: "\u6a21".repeat(100), sentinel: "\u6a21", reaches: 19 },
	];
	const retentionStatuses = [
		{ label: "no status", footer: () => "" },
		...sentinelFixtures.map(({ label, sentinel, n }) => ({ label, footer: () => sentinel.repeat(n) })),
	];
	for (const { label, id, sentinel, reaches } of modelRetentionFixtures) {
		const modelFn = () => ({ provider: "openrouter", id, reasoning: true, thinkingLevel: "high" });
		for (const { label: statusLabel, footer } of retentionStatuses) {
			let prev = -1;
			for (const width of range(1, 200)) {
				const { plain } = bar(width, { model: modelFn, footer });
				const run = plain.match(new RegExp(sentinel + "+", "u"));
				const count = run ? Array.from(run[0]).length : 0;
				assert(count >= prev, `${label} / ${statusLabel} width ${width}: model-id retention must be monotonic, got ${count} after ${prev} at a narrower width`);
				prev = Math.max(prev, count);
			}
			// 150-char id caps to NVIM_MODEL_ID_MAX visible columns (39 sentinel chars + the cap ellipsis);
			// the CJK id caps to 19 double-width chars + ellipsis = 39 columns, one short of the 40 cap -- a
			// double-width grapheme cannot be split to fill the last column.
			assert(prev === reaches, `${label} / ${statusLabel}: capped model id should reach ${reaches} sentinel chars by width 200, got ${prev}`);
		}
	}

	// Property 6 -- breath gap. Whenever the badge block and anything after it in the left cluster are
	// both rendered, exactly one space sits OUTSIDE the reverse-video block, between its right edge and
	// the next character (the badge's own trailing space lives INSIDE the block). The oracle reads the
	// RAW row at escape level: the badge's reverse-off `\x1b[27m` is followed by a run of literal
	// spaces and then the next SGR code. `\x1b[49m` there means the row ends right after the badge --
	// that code only ever closes the row-wide background at the END of the row, so the run is row
	// padding at most (w7 badge-only) and the property does not apply; ANY other code means left-cluster
	// content follows and the captured run IS the breath gap, which must be exactly 1 column. The match
	// itself is asserted: a non-match is a FAILURE, never a pass. This replaces a vacuous oracle that
	// demanded `\x1b[27m\x1b[49m` ADJACENT (never true when content follows) and null-passed via
	// `!after ||` -- caught by Biscuit's badgeGap="  " mutation, which the old P6 survived green; the
	// same mutation must now turn P6 red and is part of this suite's mutation-proof ritual.
	for (const m of retentionModels) {
		const modelFn = () => ({ provider: m.provider, id: m.id, reasoning: true, thinkingLevel: "high" });
		for (const { label, footer } of chromeFixtures) {
			for (const text of ["", "!ls"]) {
				for (const width of range(1, 200)) {
					const { raw } = bar(width, { model: modelFn, footer, text });
					const seg = raw.match(/\x1b\[27m( *)(\x1b\[[0-9;]*m)/);
					assert(seg, `${m.label} / ${label} / ${JSON.stringify(text)} width ${width}: raw row must carry the badge close \x1b[27m followed by an SGR code`);
					const [, spaces, next] = seg;
					if (next === "\x1b[49m") continue;
					assert(spaces.length === 1, `${m.label} / ${label} / ${JSON.stringify(text)} width ${width}: breath gap after the badge block must be exactly 1 space outside the block, got ${spaces.length} (next=${JSON.stringify(next)})`);
				}
			}
		}
	}


	// Width degradation ladder, verified exact at every rung boundary against the default (short model, no
	// status) fixture. The two narrow rungs (44/32) differ from the original baseline BY DESIGN: the badge
	// breath gap (Property 6) adds one space outside the block on every rung, so the model-only rungs now
	// read " HIGH  claude" instead of the old " HIGH claude" -- a deliberate, user-requested baseline
	// change recorded in docs/TEST_MATRIX.md, not a regression. The wide rungs (100/80/60) are byte-
	// identical to the pre-gap ladder: they always carried the gap as `gapWide`.
	const ladder = {
		100: " HIGH  anthropic \u00b7 claude-sonnet-4                                    \u2387 main \u00b7 84k/200k 42% \u00b7 CH 91%",
		80: " HIGH  anthropic \u00b7 claude-sonnet-4                \u2387 main \u00b7 84k/200k 42% \u00b7 CH 91%",
		60: " HIGH  anthropic \u00b7 claude-sonnet-4              \u2387 main \u00b7 42%",
		44: " HIGH  claude-sonnet-4                   42%",
		32: " HIGH  claude-sonnet-4       42%",
	};
	for (const [width, expected] of Object.entries(ladder)) {
		const b = bar(Number(width));
		assert(b.plain === expected, `nvim bar at width ${width} should match the degradation ladder exactly, got ${JSON.stringify(b.plain)}`);
		assert(b.plain.length === Number(width), `nvim bar should occupy the full terminal width exactly at ${width}, got ${b.plain.length}`);
		// The plain row (above) proves text content; also prove the RAW row carries no reset.
		assertLineIntegrity(b.raw, Number(width), `ladder width ${width}`);
	}

	// Autocomplete: prove the bar-location oracle survives extra rows appended after it, using a real
	// slash-autocomplete session (not merely a positional assumption). This populates the exact fields
	// Pi's base editor render() and this preset's own renderSlashAutocomplete() override both read.
	{
		const rows = render(100, {
			text: "/help",
			raw: true,
			autocomplete: {
				render: (w) => [" ".repeat(w)],
				filteredItems: [{ label: "help", value: "help", description: "Show help" }],
				selectedIndex: 0,
				maxVisible: 6,
			},
		});
		const { index, row } = locateNvimBar(rows);
		assert(index < rows.length - 1, "autocomplete rows should be appended AFTER the statusline bar, but the bar was the last row");
		assertLineIntegrity(row, 100, "autocomplete-on bar");
		const afterBar = rows.slice(index + 1).map(stripAnsi).join("\n");
		assert(afterBar.includes("help") && afterBar.includes("Show help"), "rows after the located bar should be the slash-autocomplete panel");
		assert(!afterBar.includes("HIGH") && !afterBar.includes("claude-sonnet-4"), "autocomplete rows should not duplicate the statusline content");
	}

	// Input frame: nvim resolves to line by default; an explicit inputBoxStyle still wins.
	const outlineOverride = render(100, { inputBoxStyle: "outline" });
	assert(outlineOverride[0].startsWith("\u250c") && outlineOverride[0].endsWith("\u2510"), "explicit inputBoxStyle: outline should still win over the nvim line default");

	// No emoji or nerd-font/powerline glyphs in the new chrome: the statusline bar and its line-rule border.
	// (The placeholder/input rows keep the pre-existing prompt glyph ❯, which is not new chrome.)
	const forbiddenGlyph = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{E000}-\u{F8FF}]/u;
	for (const width of [100, 80, 60, 44, 32]) {
		const rows = render(width);
		const b = bar(width);
		assert(!forbiddenGlyph.test(rows[0]), `nvim top border at width ${width} should not contain emoji or nerd-font glyphs: ${JSON.stringify(rows[0])}`);
		assert(!forbiddenGlyph.test(rows[2]), `nvim bottom border at width ${width} should not contain emoji or nerd-font glyphs: ${JSON.stringify(rows[2])}`);
		assert(!forbiddenGlyph.test(b.plain), `nvim statusline at width ${width} should not contain emoji or nerd-font glyphs: ${JSON.stringify(b.plain)}`);
	}

	console.log("nvim statusline smoke ok");
}

function runCompanionThemeTokenSmoke() {
	const themesDir = join(repoRoot, "node_modules", "pi-themes", "themes");
	const files = readdirSync(themesDir).filter((name) => name.endsWith(".json"));
	assert(files.length > 0, "expected bundled companion themes to be present");
	for (const file of files) {
		const theme = JSON.parse(readFileSync(join(themesDir, file), "utf8"));
		const colors = theme.colors ?? {};
		for (const token of NVIM_TOKENS) {
			assert(typeof colors[token] === "string" && colors[token].length > 0, `theme ${file} is missing the '${token}' token used by the nvim chrome`);
		}
	}
	// `accent` and `bashMode` deliberately are NOT pinned distinct here: in 5/26 companion themes they are
	// the same colour (known, accepted -- see the rationale above the badge colour assertions), so bash
	// mode there recolours the label text only. Only presence of both tokens is required, via NVIM_TOKENS.
	console.log(`companion theme token smoke ok: ${files.length} themes resolve all ${NVIM_TOKENS.length} nvim tokens`);
}

prepareWorkDir();
compileChangedSurface();

await runConfigSmoke("nvim style preserved", '{"userZoneStyle":"nvim"}', ({ config, raw }) => {
	assert(raw.userZoneStyle === "nvim", "nvim userZoneStyle was not preserved on disk");
	assert(config.userZoneStyle === "nvim", "nvim userZoneStyle did not normalize");
});

{
	const homeDir = join(workDir, "home-nvim-reload");
	mkdirSync(homeDir, { recursive: true });
	writeInitialConfig(homeDir, '{"userZoneStyle":"nvim"}');
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const { loadConfig } = await importBuilt("config.js");
	const sessionOne = loadConfig();
	assert(sessionOne.userZoneStyle === "nvim", "nvim userZoneStyle should resolve on first load");
	const sessionTwo = loadConfig();
	assert(sessionTwo.userZoneStyle === "nvim", "nvim userZoneStyle should still resolve after a second load simulating session reload");
	const raw = JSON.parse(readFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), "utf8"));
	assert(raw.userZoneStyle === "nvim", "nvim userZoneStyle should remain on disk after reload");
	console.log("config smoke ok: nvim style survives reload");
}

await runStyleResolverSmoke();
await runNvimStatuslineSmoke();
runCompanionThemeTokenSmoke();
console.log("nvim user-zone smoke ok");
