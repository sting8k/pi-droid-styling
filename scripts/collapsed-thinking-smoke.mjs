#!/usr/bin/env node
/**
 * US-024 collapsed thinking tail smoke.
 *
 * Runs against the real Pi 0.78 core in node_modules (per-block layout) plus a grouped-layout
 * stub that mirrors the Pi 0.84+ single-child layout, so both host layouts are covered.
 *
 * `WRITE_BASE_GOLDENS=1 node scripts/collapsed-thinking-smoke.mjs` captures the fixtures from
 * the current (pre-change) source into scripts/fixtures/collapsed-thinking-base.json. That file
 * is the byte-for-byte base-commit baseline P6 compares against.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "collapsed-thinking-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
const home = join(workDir, "home");
const configPath = join(home, ".pi", "agent", "pi-droid-styling.json");
const goldenPath = join(repoRoot, "scripts", "fixtures", "collapsed-thinking-base.json");
const WRITE_GOLDENS = process.env.WRITE_BASE_GOLDENS === "1";
const coreVersion = JSON.parse(readFileSync(join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8")).version;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const failures = [];
function check(name, fn) {
	try {
		fn();
	} catch (error) {
		failures.push(`${name}: ${error?.message ?? error}`);
	}
}

const stripAnsi = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const rowWith = (rawLines, needle) => rawLines.find((line) => stripAnsi(line).includes(needle));
const graphemeSegments = (text) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
const isGraphemeSuffix = (source, tail) => graphemeSegments(source).some((_, index) => graphemeSegments(source).slice(index).join("") === tail);

function prepareBuild() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	mkdirSync(dirname(configPath), { recursive: true });
	mkdirSync(dirname(goldenPath), { recursive: true });
	writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
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
	export * from "fs";
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const resolve: (...parts: string[]) => string;
	export const relative: (from: string, to: string) => string;
}
declare module "node:path" {
	export * from "path";
}
declare module "os" {
	export const homedir: () => string;
}
declare module "node:os" {
	export * from "os";
}
declare module "node:url" {
	export const fileURLToPath: (url: string | URL) => string;
}
declare module "node:buffer" {
	export const Buffer: any;
}
declare module "node:perf_hooks" {
	export const monitorEventLoopDelay: any;
	export const performance: any;
}
declare const process: any;
`, "utf8");

	const result = spawnSync(process.execPath, [
		tsc,
		"--target", "ES2022",
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--outDir", buildDir,
		"--rootDir", repoRoot,
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		join(repoRoot, "config.ts"),
		join(repoRoot, "user-zone", "designs.ts"),
		join(repoRoot, "presentation", "designs.ts"),
		join(repoRoot, "presentation", "state.ts"),
		join(repoRoot, "messages", "assistant-content-runs.ts"),
		join(repoRoot, "messages", "assistant-prefix.ts"),
		join(repoRoot, "render-budget.ts"),
		join(repoRoot, "performance", "profiler.ts"),
		join(repoRoot, "theme", "theme-extras.ts"),
		join(repoRoot, "theme", "ansi.ts"),
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`tsc failed\n${result.stdout}\n${result.stderr}`);
}

const CONFIG_MTIME_BASE = 1_700_000_000;
let configMtime = CONFIG_MTIME_BASE;

function writeConfig(config) {
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	configMtime += 2;
	utimesSync(configPath, configMtime, configMtime);
}

// ---- isolated HOME + controllable clock so loadConfig's 1s throttle cannot hide a rewrite ----
let fakeNow = 2_000_000;
Date.now = () => fakeNow;
function setConfig(config) {
	writeConfig(config);
	fakeNow += 5_000;
}

prepareBuild();
process.env.HOME = home;
writeConfig({ collapsedThinking: "tail" });

const themeExtras = await import(pathToFileURL(join(buildDir, "theme", "theme-extras.js")).href);
const state = await import(pathToFileURL(join(buildDir, "presentation", "state.js")).href);
const budget = await import(pathToFileURL(join(buildDir, "render-budget.js")).href);
const runsModule = await import(pathToFileURL(join(buildDir, "messages", "assistant-content-runs.js")).href);
const prefixModule = await import(pathToFileURL(join(buildDir, "messages", "assistant-prefix.js")).href);
const configModule = await import(pathToFileURL(join(buildDir, "config.js")).href);
const streamingState = await import(pathToFileURL(join(buildDir, "messages", "assistant-streaming-state.js")).href);

const { initTheme, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
const { Markdown, Spacer } = await import("@earendil-works/pi-tui");
initTheme("dark");

const themeFile = join(workDir, "smoke-theme.json");
writeFileSync(themeFile, `${JSON.stringify({
	name: "collapsed-smoke",
	vars: { muted: "#6c7086", thinkingText: "#89b4fa" },
	extras: {},
}, null, 2)}\n`, "utf8");

const activeTheme = {
	sourcePath: themeFile,
	fg: (color, text) => `\x1b[38;5;7m${text}\x1b[39m`,
	italic: (text) => `\x1b[3m${text}\x1b[23m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	getColorMode: () => "truecolor",
};
themeExtras.setFullTheme(activeTheme, true);

state.setPresentationStyle("reasonix");
prefixModule.installAssistantMessagePrefix(activeTheme);

// Liveness is captured when a component is patched, so a check marks the stream active around the
// updateContent call it wants to observe live. The tracked message object must be the same one fed
// to updateContent, mirroring Pi core passing the message_start/message_update event message through.
function withActiveStream(message, fn) {
	streamingState.beginAssistantStream(message);
	try {
		return fn();
	} finally {
		streamingState.endAssistantStream();
	}
}

// ---------------------------------------------------------------- grouped-layout stub (Pi 0.84+)
const isVisibleBlock = (block) => (block.type === "text" && block.text.trim()) || (block.type === "thinking" && block.thinking.trim());

class GroupedLayoutStub {
	constructor(message, hideThinkingBlock = true, hiddenThinkingLabel = "StubLabel", overrides) {
		this.hideThinkingBlock = hideThinkingBlock;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.thinkingVisibilityOverrides = overrides;
		this.contentContainer = { children: [] };
		if (message) this.updateContent(message);
	}
	// mirrors Pi >= 0.84: consecutive thinking blocks collapse into a single child
	updateContent(message) {
		const children = [];
		if (message.content.some(isVisibleBlock)) children.push(new Spacer(1));
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "text" && block.text.trim()) {
				children.push(new Markdown(block.text.trim(), 1, 0));
				continue;
			}
			if (block.type !== "thinking") continue;
			const thinkingBlocks = [];
			for (; i < message.content.length && message.content[i].type === "thinking"; i++) {
				if (message.content[i].thinking.trim()) thinkingBlocks.push(message.content[i].thinking.trim());
			}
			i--;
			if (thinkingBlocks.length === 0) continue;
			children.push(new Markdown(thinkingBlocks.join("\n\n"), 1, 0));
			if (message.content.slice(i + 1).some(isVisibleBlock)) children.push(new Spacer(1));
		}
		this.contentContainer.children = children;
	}
}

prefixModule.installAssistantMessagePrefix(activeTheme, GroupedLayoutStub);

function groupedThinkingChild(message, options = {}) {
	const component = new GroupedLayoutStub(message, options.hideThinkingBlock ?? true, options.label ?? "Thinking...", options.overrides);
	const runs = runsModule.getAssistantContentRuns(component, message);
	return { component, runs, childAt: (index) => component.contentContainer.children[runs[index].childIndex] };
}

// ---------------------------------------------------------------- fixtures (base-commit goldens)
const LONG_ASCII = Array.from({ length: 300 }, (_, index) => String.fromCharCode(97 + (index % 26))).join("");
const CJK_LINE = "思考のながれ".repeat(24);
const EMOJI_LINE = "🙂🚀".repeat(80);

const FIXTURES = [
	{ name: "thinking-only", content: [{ type: "thinking", thinking: "alpha" }] },
	{ name: "thinking-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "two-thoughts-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "thinking", thinking: "beta" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "three-thoughts-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "thinking", thinking: "beta" }, { type: "thinking", thinking: "gamma" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "thinking-toolcall", content: [{ type: "thinking", thinking: "alpha" }, { type: "toolCall", id: "1", name: "read", arguments: {} }] },
	{ name: "split-runs", content: [{ type: "thinking", thinking: "firstthought" }, { type: "text", text: "MIDANSWER" }, { type: "thinking", thinking: "secondthought" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "text-only", content: [{ type: "text", text: "just an answer" }] },
];

function renderFixture(fixture, hideThinking, width) {
	return new AssistantMessageComponent({ role: "assistant", content: fixture.content }, hideThinking).render(width);
}

function captureGoldens() {
	const goldens = {};
	for (const fixture of FIXTURES) {
		goldens[fixture.name] = {};
		for (const hideThinking of [true, false]) {
			goldens[fixture.name][String(hideThinking)] = {};
			for (const width of [46, 80]) {
				goldens[fixture.name][String(hideThinking)][String(width)] = renderFixture(fixture, hideThinking, width);
			}
		}
	}
	return goldens;
}

if (WRITE_GOLDENS) {
	const existing = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, "utf8")) : {};
	existing[coreVersion] = captureGoldens();
	writeFileSync(goldenPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
	console.log(`captured base goldens for ${coreVersion}: ${goldenPath}`);
	process.exit(0);
}

const goldenBook = JSON.parse(readFileSync(goldenPath, "utf8"));
const goldens = goldenBook[coreVersion];

// ---------------------------------------------------------------- P1..P11 + config cases
const LIVE_TAIL = "nên child index phải đi theo rendered run, không phải raw block";
// Real pi-ai shape: every streaming partial already carries stopReason "stop" from the first delta.
const hiddenOnly = (thinking, stopReason = "stop") => ({ role: "assistant", content: [{ type: "thinking", thinking }], stopReason });
const liveMessage = hiddenOnly(LIVE_TAIL);

check("P1 real core (0.78 per-block) live tail", () => {
	const message = hiddenOnly(LIVE_TAIL);
	const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(120));
	const row = rowWith(raw, "Thinking");
	assert(row !== undefined, `collapsed row missing: ${JSON.stringify(raw.map(stripAnsi))}`);
	assert(stripAnsi(row).includes("▸"), `live marker missing: ${JSON.stringify(stripAnsi(row))}`);
	assert(stripAnsi(row).includes(LIVE_TAIL), `whole tail line should fit at width 120: ${JSON.stringify(stripAnsi(row))}`);
	const again = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(120));
	assert(raw.length === again.length, "row count must not change");
});

check("P1 grouped layout live tail (1/2/3 blocks)", () => {
	for (const thoughts of [["a"], ["alpha", "beta"], ["alpha", "beta", "gamma"]]) {
		const message = { role: "assistant", stopReason: "stop", content: thoughts.map((thinking) => ({ type: "thinking", thinking })) };
		const { childAt } = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking..." }));
		const plain = childAt(0).render(60).map(stripAnsi).join("\n");
		assert(plain.includes("Thinking ▸"), `grouped ${thoughts.length}: trimmed label missing: ${plain}`);
		assert(plain.includes("▸"), `grouped ${thoughts.length}: live marker missing: ${plain}`);
		assert(plain.includes(`▸ ${thoughts[thoughts.length - 1]}`), `grouped ${thoughts.length}: tail should come from the last block: ${plain}`);
	}
});

check("P2a settled after the stream ends", () => {
	for (const stopReason of ["stop", "aborted", "error"]) {
		const partial = hiddenOnly(LIVE_TAIL);
		const component = withActiveStream(partial, () => new AssistantMessageComponent(partial, true));
		assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("▸"), `${stopReason}: partial should start live`);
		component.updateContent({ ...partial, stopReason });
		const row = stripAnsi(rowWith(component.render(120), "Thinking"));
		assert(row.includes("·") && !row.includes("▸"), `${stopReason}: settled marker missing: ${JSON.stringify(row)}`);
		assert(row.includes(LIVE_TAIL), `${stopReason}: tail missing`);
	}
});

check("P2b stopReason is not the liveness signal", () => {
	const component = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: LIVE_TAIL }] }, true);
	const row = stripAnsi(rowWith(component.render(120), "Thinking"));
	assert(row.includes("·") && !row.includes("▸"), `undefined stopReason with no stream must be settled: ${JSON.stringify(row)}`);
});

check("P2c begin live -> end settled on one component", () => {
	const partial = hiddenOnly("alpha");
	const component = new AssistantMessageComponent(undefined, true);
	streamingState.beginAssistantStream(partial);
	component.updateContent(partial);
	assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("▸"), "live while the stream is active");
	streamingState.endAssistantStream();
	component.updateContent(hiddenOnly("alpha"));
	assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("·"), "settled once the stream ends");
});

check("P2d an older component does not adopt a newer stream", () => {
	const first = hiddenOnly("alpha");
	const older = withActiveStream(first, () => new AssistantMessageComponent(first, true));
	assert(stripAnsi(rowWith(older.render(120), "Thinking")).includes("▸"), "older component is live in its own stream");
	const newerMessage = hiddenOnly("beta");
	withActiveStream(newerMessage, () => {
		const newer = new AssistantMessageComponent(newerMessage, true);
		assert(stripAnsi(rowWith(newer.render(120), "Thinking")).includes("▸"), "newer component is live in the new stream");
		older.updateContent(older.lastMessage);
		const row = stripAnsi(rowWith(older.render(120), "Thinking"));
		assert(row.includes("·") && !row.includes("▸"), `older component must stay settled during a newer stream: ${JSON.stringify(row)}`);
	});
});

check("P2e a history component rebuilt mid-stream stays settled", () => {
	const streamMessage = hiddenOnly("streaming-thought");
	const historyMessage = hiddenOnly("history-thought");
	withActiveStream(streamMessage, () => {
		const history = new AssistantMessageComponent(historyMessage, true);
		const row = stripAnsi(rowWith(history.render(120), "Thinking"));
		assert(row.includes("·") && !row.includes("▸"), `history component must stay settled: ${JSON.stringify(row)}`);
	});
});

check("P2f the streaming component tolerates a clone of the tracked message", () => {
	const tracked = hiddenOnly("alpha");
	streamingState.beginAssistantStream(tracked);
	try {
		const fresh = new AssistantMessageComponent(tracked, true);
		assert(stripAnsi(rowWith(fresh.render(120), "Thinking")).includes("▸"), "streaming component is live");
		fresh.updateContent({ ...tracked, content: [{ type: "thinking", thinking: "alpha beta" }] });
		assert(stripAnsi(rowWith(fresh.render(120), "Thinking")).includes("▸"), "a structural clone must still read the tag made from the tracked message");
	} finally {
		streamingState.endAssistantStream();
	}
});

check("P2g a new stream does not revive the previous component", () => {
	const first = hiddenOnly("alpha");
	const component = withActiveStream(first, () => new AssistantMessageComponent(first, true));
	assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("▸"), "component is live in its own stream");
	withActiveStream(hiddenOnly("beta"), () => {
		component.updateContent(component.lastMessage);
		const row = stripAnsi(rowWith(component.render(120), "Thinking"));
		assert(row.includes("·") && !row.includes("▸"), `previous component must stay settled: ${JSON.stringify(row)}`);
	});
});

check("P3 answer/tool-call follows settles the row", () => {
	for (const follower of [{ type: "text", text: "streaming answer" }, { type: "toolCall", id: "1", name: "read", arguments: {} }]) {
		const message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "alpha" }, follower] };
		const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(60));
		const row = stripAnsi(rowWith(raw, "Thinking"));
		assert(row.includes("·") && !row.includes("▸"), `follower ${follower.type}: thinking row should be settled: ${JSON.stringify(row)}`);
	}
});

check("P4 truncation is left-anchored and monotonic", () => {
	let previousTailLength = -1;
	for (const width of [40, 80, 160]) {
		const message = hiddenOnly(LONG_ASCII);
		const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(width));
		const row = stripAnsi(rowWith(raw, "Thinking"));
		assert(row.includes("…"), `width ${width}: truncated tail should start with an ellipsis: ${JSON.stringify(row)}`);
		const tail = row.slice(row.indexOf("…") + 1);
		assert(LONG_ASCII.endsWith(tail), `width ${width}: tail must be the end of the line: ${JSON.stringify(tail.slice(0, 12))}`);
		assert(budget.safeVisibleWidth(row.trimEnd()) <= width, `width ${width}: row overflows`);
		assert(tail.length >= previousTailLength, `width ${width}: widening must not show fewer trailing characters`);
		previousTailLength = tail.length;
	}
});

check("P4 wide graphemes are dropped whole", () => {
	for (const source of [CJK_LINE, EMOJI_LINE]) {
		for (const width of [40, 80, 161]) {
			const message = hiddenOnly(source);
			const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(width));
			const row = stripAnsi(rowWith(raw, "Thinking")).trimEnd();
			const tail = row.slice(row.indexOf("…") + 1);
			assert(isGraphemeSuffix(source, tail), `width ${width}: tail split a grapheme: ${JSON.stringify(tail.slice(0, 6))}`);
			assert(budget.safeVisibleWidth(row) <= width, `width ${width}: wide grapheme row overflows`);
		}
	}
});

check("P4 whitespace right after the ellipsis is trimmed", () => {
	// At width 40 (reasonix body 37, label "Thinking" = 8) the tail budget is 25 → the last 24 columns are kept;
	// 23 y's plus the space before them land the cut exactly on that space.
	const text = `${"z".repeat(50)} ${"y".repeat(23)}`;
	const message = hiddenOnly(text);
	const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(40));
	const row = stripAnsi(rowWith(raw, "Thinking")).trimEnd();
	const tail = row.slice(row.indexOf("…") + 1);
	assert(tail === "y".repeat(23), `cut on whitespace must drop the space after the ellipsis: ${JSON.stringify(tail)}`);
});

check("P8 label from hiddenThinkingLabel (trailing progress dots trimmed) + no hardcoded label", () => {
	const label = "Reasoning…";
	const raw = withActiveStream(liveMessage, () => new AssistantMessageComponent(liveMessage, true, undefined, label).render(60));
	const row = rowWith(raw, "Reasoning");
	assert(row !== undefined, "component.hiddenThinkingLabel must be the label source");
	assert(stripAnsi(row).includes("Reasoning ▸"), `trailing dots must be trimmed so the marker carries the state: ${JSON.stringify(stripAnsi(row))}`);
	assert(!stripAnsi(row).includes("Reasoning…"), "label's own ellipsis must not survive in tail mode");
	assert(!raw.some((line) => stripAnsi(line).includes("Thinking")), "module must not fall back to a hardcoded label");
	const source = readFileSync(join(repoRoot, "messages", "assistant-prefix.ts"), "utf8");
	assert(!source.includes("Thinking..."), "assistant-prefix.ts must not contain the literal label");
});

check("P7 visibility overrides (0.85) + no-map fallthrough (0.78)", () => {
	const message = {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "visible-thought" },
			{ type: "text", text: "MIDANSWER" },
			{ type: "thinking", thinking: "hidden-thought" },
		],
	};
	const overridden = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking...", overrides: new Map([[0, false]]) }));
	const visibleRow = stripAnsi(overridden.childAt(0).render(60).join("\n"));
	const hiddenRow = stripAnsi(overridden.childAt(2).render(60).join("\n"));
	assert(visibleRow.includes("visible-thought") && !visibleRow.includes("Thinking"), `override run 0 should use the visible path: ${visibleRow}`);
	assert(hiddenRow.includes("Thinking ▸") && hiddenRow.includes("hidden-thought"), `override run 1 should use the tail row: ${hiddenRow}`);

	const noMap = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking..." }));
	// run 0 is followed by text, so its collapsed row is settled (·) even while the stream is live
	assert(stripAnsi(noMap.childAt(0).render(60).join("\n")).includes("Thinking ·"), "a host with no override map must collapse every run");
});

check("P9 updateContent is the only source", () => {
	const first = hiddenOnly("alpha\nbeta");
	streamingState.beginAssistantStream(first);
	try {
		const component = new AssistantMessageComponent(first, true);
		assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("▸ beta"), "first update should tail beta");
		component.updateContent(hiddenOnly("alpha\nbeta gamma"));
		assert(stripAnsi(rowWith(component.render(120), "Thinking")).includes("▸ beta gamma"), "second update should advance the tail");
		const before = component.render(120);
		assert(JSON.stringify(before) === JSON.stringify(component.render(120)), "rendering twice without an update must be stable");
	} finally {
		streamingState.endAssistantStream();
	}
	const source = readFileSync(join(repoRoot, "messages", "assistant-prefix.ts"), "utf8");
	assert(!source.includes("setTimeout") && !source.includes("addListener"), "the row must not add event or timer sources");
});

check("P10 style split", () => {
	for (const style of ["reasonix", "droid"]) {
		state.setPresentationStyle(style);
		const raw = withActiveStream(liveMessage, () => new AssistantMessageComponent(liveMessage, true).render(80));
		const row = rowWith(raw, "Thinking");
		const tailStart = row.indexOf("\x1b[38;2;108;112;134m");
		assert(tailStart > 0, `${style}: tail/marker must use the resolved muted escape: ${JSON.stringify(row)}`);
		const labelSegment = row.slice(0, tailStart);
		const tailSegment = row.slice(tailStart);
		assert(tailSegment.includes("▸"), `${style}: marker must live in the styled tail segment`);
		assert(labelSegment.includes("\x1b[1m"), `${style}: label must be bold`);
		assert(labelSegment.includes("\x1b[38;5;7m"), `${style}: label must use thinkingText`);
		assert(!labelSegment.includes("\x1b[3m"), `${style}: label must be upright (never italic)`);
		assert(!tailSegment.includes("\x1b[1m"), `${style}: bold must not leak into the tail`);
		assert(!tailSegment.includes("\x1b[3m"), `${style}: tail/marker must never be italic`);
	}
});

check("P10 theme extra recolours only the tail", () => {
	const redTheme = { ...activeTheme, sourcePath: join(workDir, "red-theme.json") };
	writeFileSync(redTheme.sourcePath, `${JSON.stringify({ name: "collapsed-red", vars: { muted: "#6c7086", thinkingText: "#89b4fa" }, extras: { collapsedThinkingTailColor: "#ff0000" } }, null, 2)}\n`, "utf8");
	themeExtras.setFullTheme(redTheme, true);
	prefixModule.installAssistantMessagePrefix(redTheme);
	const raw = withActiveStream(liveMessage, () => new AssistantMessageComponent(liveMessage, true).render(80));
	const row = rowWith(raw, "Thinking");
	const redStart = row.indexOf("\x1b[38;2;255;0;0m");
	assert(redStart > 0 && row.slice(redStart).includes("▸"), "explicit tail colour must apply to the marker/tail");
	assert(!row.slice(0, redStart).includes("\x1b[38;2;255;0;0m"), "explicit tail colour must not leak into the label");
	themeExtras.setFullTheme(activeTheme, true);
	prefixModule.installAssistantMessagePrefix(activeTheme);
});

check("P11 interleaved runs keep prefix/gutter placement", () => {
	state.setPresentationStyle("reasonix");
	// thinking -> text -> thinking: the first run is prefixed and settled, the trailing run is live.
	const live = {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "firstthought" },
			{ type: "text", text: "MIDANSWER" },
			{ type: "thinking", thinking: "secondthought" },
		],
	};
	const raw = withActiveStream(live, () => new AssistantMessageComponent(live, true).render(80));
	const first = stripAnsi(raw.find((line) => stripAnsi(line).includes("firstthought")));
	const second = stripAnsi(raw.find((line) => stripAnsi(line).includes("secondthought")));
	assert(first.startsWith("• "), `first thinking run should keep the top-level marker: ${JSON.stringify(first)}`);
	assert(first.includes("·") && !first.includes("▸"), "the first run is followed by text, so it settled");
	assert(second.includes("▸") && second.includes("secondthought"), `the trailing run has nothing after it, so it stays live: ${JSON.stringify(second)}`);

	// thinking -> text -> thinking -> text: the second run takes the gutter column, both settled.
	const gutter = {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "firstthought" },
			{ type: "text", text: "MIDANSWER" },
			{ type: "thinking", thinking: "secondthought" },
			{ type: "text", text: "FINALANSWER" },
		],
	};
	const gutterRaw = withActiveStream(gutter, () => new AssistantMessageComponent(gutter, true).render(80));
	const gutterRow = stripAnsi(gutterRaw.find((line) => stripAnsi(line).includes("secondthought")));
	assert(gutterRow.startsWith("  Thinking ·"), `gutter run should keep its indent: ${JSON.stringify(gutterRow)}`);
	assert(gutterRow.includes("·") && !gutterRow.includes("▸"), "the gutter run is followed by text, so it settled");
});

check(`P6 label mode + visible thinking stay byte-identical to base ${coreVersion}`, () => {
	assert(goldens !== undefined, `no base goldens captured for Pi ${coreVersion}`);
	state.setPresentationStyle("reasonix");
	setConfig({ collapsedThinking: "tail" });
	for (const fixture of FIXTURES) {
		for (const width of [46, 80]) {
			const actual = renderFixture(fixture, false, width);
			assert(JSON.stringify(actual) === JSON.stringify(goldens[fixture.name].false[String(width)]), `visible thinking changed for ${fixture.name} @${width}`);
		}
	}
	setConfig({ collapsedThinking: "label" });
	for (const fixture of FIXTURES) {
		for (const hideThinking of [true, false]) {
			for (const width of [46, 80]) {
				const actual = renderFixture(fixture, hideThinking, width);
				assert(
					JSON.stringify(actual) === JSON.stringify(goldens[fixture.name][String(hideThinking)][String(width)]),
					`label mode changed ${fixture.name} hideThinking=${hideThinking} @${width}`,
				);
			}
		}
	}
	setConfig({ collapsedThinking: "tail" });
});

check("P5 narrow widths fall back to the label row", () => {
	state.setPresentationStyle("reasonix");
	// label "Thinking" = 8 cols → the tail needs body ≥ 28, i.e. width ≥ 31 under reasonix; everything below is label-only.
	for (const width of [20, 26, 28, 30]) {
		setConfig({ collapsedThinking: "label" });
		const label = renderFixture({ name: "n", content: [{ type: "thinking", thinking: "alpha" }] }, true, width);
		setConfig({ collapsedThinking: "tail" });
		const tail = renderFixture({ name: "n", content: [{ type: "thinking", thinking: "alpha" }] }, true, width);
		assert(JSON.stringify(label) === JSON.stringify(tail), `width ${width}: narrow tail row must equal the label row`);
	}
	setConfig({ collapsedThinking: "tail" });
});

check("safeTakeTailToWidth unit behaviour", () => {
	assert(budget.safeTakeTailToWidth("abcdef", 10) === "abcdef", "short text should pass through");
	assert(budget.safeTakeTailToWidth("abcdefgh", 4) === "…fgh", "long text should keep the last columns with an ellipsis");
	assert(budget.safeTakeTailToWidth("abcdefgh", 1) === "…", "width 1 should leave the ellipsis only");
	assert(budget.safeTakeTailToWidth("abcdefgh", 0) === "", "width 0 should be empty");
	assert(budget.safeTakeTailToWidth("あいうえお", 4) === "…お", "wide text should not split a grapheme");
	assert(budget.safeVisibleWidth(budget.safeTakeTailToWidth("あいうえお", 4)) <= 4, "wide tail must stay within budget");
});

// ---------------------------------------------------------------- config scaffold/normalise cases
async function loadConfigCase(name, initialConfig) {
	const caseHome = join(workDir, `config-${name}`);
	const casePath = join(caseHome, ".pi", "agent", "pi-droid-styling.json");
	mkdirSync(dirname(casePath), { recursive: true });
	if (initialConfig !== undefined) writeFileSync(casePath, `${JSON.stringify(initialConfig)}\n`, "utf8");
	process.env.HOME = caseHome;
	const moduleUrl = `${pathToFileURL(join(buildDir, "config.js")).href}?case=${name}`;
	const { loadConfig } = await import(moduleUrl);
	const config = loadConfig();
	assert(existsSync(casePath), `${name}: config file was not scaffolded`);
	return { config, raw: JSON.parse(readFileSync(casePath, "utf8")) };
}

const scaffoldedCase = await loadConfigCase("scaffold", undefined);
check("config scaffold default is tail", () => {
	assert(scaffoldedCase.config.collapsedThinking === "tail", "new config should default collapsedThinking to tail");
	assert(scaffoldedCase.raw.collapsedThinking === "tail", "scaffolded file should include collapsedThinking");
});

const labelCase = await loadConfigCase("label", { collapsedThinking: "label" });
check("config label is preserved", () => {
	assert(labelCase.config.collapsedThinking === "label", "explicit label must be preserved");
});

const invalidCase = await loadConfigCase("invalid", { collapsedThinking: "neon" });
check("config invalid normalises to tail", () => {
	assert(invalidCase.config.collapsedThinking === "tail", "invalid collapsedThinking must normalise to tail");
	assert(invalidCase.raw.collapsedThinking === "tail", "invalid collapsedThinking must be backfilled on disk");
});

const missingCase = await loadConfigCase("missing", { presentationStyle: "droid" });
check("config missing key is backfilled", () => {
	assert(missingCase.config.collapsedThinking === "tail", "missing collapsedThinking must default to tail");
	assert(missingCase.raw.collapsedThinking === "tail", "missing collapsedThinking must be backfilled on disk");
});

process.env.HOME = home;

if (failures.length > 0) {
	console.error(`collapsed thinking smoke FAILED (${failures.length}):`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("collapsed thinking smoke ok");
