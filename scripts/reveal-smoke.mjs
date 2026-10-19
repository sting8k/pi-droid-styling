#!/usr/bin/env node
/**
 * Smooth reveal of streamed answers (messages/reveal.ts) on a virtual clock: Date.now and setTimeout are
 * replaced by a scheduler the smoke advances by hand, so pacing is exact. Unit cases drive `revealBody`
 * with hand-built rows; the last case runs the real AssistantMessageComponent through prefix + presentation
 * buffer + finished-render cache. Prints the per-frame cost of the reveal on a long answer.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("reveal-smoke", [
	"messages/reveal.ts",
	"messages/assistant-prefix.ts",
	"performance/debounce-update.ts",
	"performance/finished-render-cache.ts",
]);
const streaming = await built.importBuilt("messages/assistant-streaming-state.js");
const reveal = await built.importBuilt("messages/reveal.js");
const debounce = await built.importBuilt("performance/debounce-update.js");
const finishedCache = await built.importBuilt("performance/finished-render-cache.js");
const { installAssistantMessagePrefix } = await built.importBuilt("messages/assistant-prefix.js");
const { initTheme, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");

// ── virtual clock ──
let clock = 1_000_000;
let nextId = 0;
const timers = new Map();
Date.now = () => clock;
globalThis.setTimeout = (fn, ms = 0) => {
	timers.set(++nextId, { at: clock + ms, fn });
	return nextId;
};
globalThis.clearTimeout = (id) => void timers.delete(id);
function advance(ms) {
	const end = clock + ms;
	for (;;) {
		let next;
		for (const [id, timer] of timers) if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
		if (!next) break;
		timers.delete(next.id);
		clock = Math.max(clock, next.timer.at);
		next.timer.fn();
	}
	clock = end;
}

const failures = [];
const expect = (name, condition, detail = "") => {
	if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (text) => String(text).replace(SGR, "");
const FRAME = 33;
const FAINT = [82, 91, 84];
const INK = [216, 212, 180];

let renders = 0;
reveal.setRevealRenderRequester(() => void renders++);
// Fade colors come from the UI theme: `dim` is where the fade starts, `text` is the target for default-colored chars.
const themeOf = (mode) => ({
	getColorMode: () => mode,
	getFgAnsi: (token) => (token === "dim" ? `\x1b[38;2;${FAINT.join(";")}m` : `\x1b[38;2;${INK.join(";")}m`),
});
reveal.setRevealTheme(themeOf("truecolor"));

const ink = (text) => `\x1b[38;2;216;212;180m${text}\x1b[39m`;
const WIDTH = 42;
/** Rows of ink text, padded like Markdown pads them to the full width. */
function rowsOf(text, size = 40) {
	const rows = [];
	for (let i = 0; i < text.length; i += size) rows.push(ink(text.slice(i, i + size)) + " ".repeat(Math.max(0, WIDTH - Math.min(size, text.length - i))));
	return rows;
}
const burst = Array.from({ length: 400 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
const visibleChars = (rows) => rows.reduce((sum, row) => sum + [...plain(row).trimEnd()].length, 0);

function liveComponent() {
	const message = {};
	const component = {};
	streaming.beginAssistantStream(message);
	streaming.attachComponentToStream(component, message);
	return component;
}

/** Render once per frame until `done(rows)` or `limitMs`; returns the frames and the elapsed time. */
function playFrames(component, rows, limitMs, done) {
	const frames = [];
	let elapsed = 0;
	for (; elapsed <= limitMs; elapsed += FRAME) {
		const shown = reveal.revealBody(component, rows);
		frames.push(shown);
		if (done(shown)) break;
		advance(FRAME);
	}
	return { frames, elapsed };
}

// ── burst: linear growth, bounded lag, then the ticker goes quiet ──
{
	const component = liveComponent();
	const rows = rowsOf(burst);
	const { frames, elapsed } = playFrames(component, rows, 1000, (shown) => shown.length === rows.length && plain(shown.at(-1)) === plain(rows.at(-1)));
	const counts = frames.map(visibleChars);
	const steps = counts.slice(1).map((c, i) => c - counts[i]).filter((step) => step > 0);
	const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
	expect("burst reveals gradually", frames.length > 5 && counts[1] < 120, `counts ${counts.slice(0, 6)}`);
	expect("burst grows ~linearly", steps.slice(0, -2).every((step) => step > mean * 0.5 && step < mean * 1.5), `steps ${steps}`);
	expect("burst lag is bounded", elapsed <= 450, `${elapsed}ms`);
	expect("burst ends complete", visibleChars(frames.at(-1)) === 400);

	advance(500); // the fade tail settles, then the ticker must stop although the stream is still live
	const settled = reveal.revealBody(component, rows);
	expect("settled rows are untouched", settled.length === rows.length && settled.every((row, i) => row === rows[i]));
	const before = renders;
	advance(1000);
	expect("ticker stops when caught up", timers.size === 0 && renders === before, `timers ${timers.size}, renders +${renders - before}`);

	// more text on a live stream restarts it
	const more = rowsOf(burst + "z".repeat(80));
	reveal.revealBody(component, more);
	expect("new text restarts the ticker", timers.size === 1);
	streaming.endAssistantStream();
	advance(1000);
	reveal.revealBody(component, more);
	expect("ended and caught up: state released", !reveal.isRevealing(component));
}

// ── fade: the newest chars sit between faint and their own color ──
{
	const component = liveComponent();
	const rows = rowsOf(burst);
	const { frames } = playFrames(component, rows, 1000, (shown) => visibleChars(shown) > 160);
	const shown = frames.at(-1);
	const last = shown.at(-1);
	const tail = [...last.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m([^\x1b])/g)].filter((m) => m[4] !== " ");
	const reds = tail.map((m) => Number(m[1]));
	expect("tail is a gradient", tail.length >= 4 && reds.every((r, i) => i === 0 || r < reds[i - 1]), `reds ${reds}`);
	expect("tail starts at ink side and ends at faint side", reds[0] <= INK[0] && Math.abs(reds.at(-1) - FAINT[0]) < Math.abs(reds.at(-1) - INK[0]), `reds ${reds}`);
	expect("rows above the fade window are untouched", shown.slice(0, -2).every((row, i) => row === rows[i]));
	streaming.endAssistantStream();
	advance(1000);
}

// ── a 256-color theme cuts without the truecolor fade ──
{
	reveal.setRevealTheme(themeOf("256color"));
	const component = liveComponent();
	const rows = rowsOf(burst);
	const { frames } = playFrames(component, rows, 1000, (shown) => visibleChars(shown) > 160);
	const last = frames.at(-1).at(-1);
	expect("256color: no fade colors", !/\x1b\[38;2;(?!216;212;180m)/.test(last), JSON.stringify(last));
	expect("256color: still reveals gradually", frames.length > 2 && visibleChars(frames.at(-1)) < 400);
	streaming.endAssistantStream();
	advance(1000);
	reveal.setRevealTheme(themeOf("truecolor"));
}

// ── cuts never split an escape or a grapheme, and never exceed the row ──
{
	const component = liveComponent();
	const text = "héllo 👨‍👩‍👧 世界 🙂 🇨🇭 e\u0301 tail end of the line here, okay?";
	const link = "\x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\";
	const rows = [`\x1b[1m${ink(text)}\x1b[22m` + " ".repeat(8), `\x1b[3m${link} ${ink("after")}\x1b[23m`];
	const segment = (s) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((p) => p.segment);
	const original = segment(text);
	const { frames } = playFrames(component, rows, 3000, (shown) => shown.length === rows.length && plain(shown.at(-1)) === plain(rows.at(-1)));
	let bad = "";
	for (const frame of frames) {
		for (const row of frame) {
			const stripped = row.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
			if (stripped.includes("\x1b")) bad = `stray escape in ${JSON.stringify(row)}`;
		}
		const first = plain(frame[0] ?? "").replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").trimEnd();
		const got = segment(first);
		if (!got.every((g, i) => g === original[i])) bad = `not a grapheme prefix: ${JSON.stringify(first)}`;
		if (frame.some((row, i) => visibleWidth(row) > visibleWidth(rows[i]))) bad = "row grew";
	}
	expect("no partial escapes, split graphemes, or growth", bad === "", bad);
	streaming.endAssistantStream();
	advance(1000);
}

// ── end of stream: the rest shows within 300ms ──
{
	const component = liveComponent();
	const rows = rowsOf(burst);
	reveal.revealBody(component, rows);
	advance(FRAME);
	reveal.revealBody(component, rows);
	streaming.endAssistantStream();
	const { frames, elapsed } = playFrames(component, rows, 1000, (shown) => shown.length === rows.length && shown.every((row, i) => row === rows[i]));
	expect("rest appears <= 300ms after the stream ends", elapsed <= 300 && frames.at(-1).every((row, i) => row === rows[i]), `${elapsed}ms`);
	reveal.revealBody(component, rows);
	expect("state released after the end", !reveal.isRevealing(component));
}

// ── finished / resumed messages and the off switch render instantly ──
{
	const rows = rowsOf(burst);
	expect("history component renders whole", reveal.revealBody({}, rows) === rows);
	const component = liveComponent();
	process.env.PI_REDUCED_MOTION = "1";
	expect("reduced motion renders whole", reveal.revealBody(component, rows) === rows);
	delete process.env.PI_REDUCED_MOTION;
	streaming.endAssistantStream();
}

// ── real component: prefix + presentation buffer + finished-render cache ──
{
	let delegated = 0;
	let counted;
	const baseUpdate = AssistantMessageComponent.prototype.updateContent;
	AssistantMessageComponent.prototype.updateContent = function countUpdates(message) {
		if (this === counted) delegated++;
		return baseUpdate.call(this, message);
	};
	installAssistantMessagePrefix(undefined, AssistantMessageComponent);
	debounce.installAssistantUpdateDebounce(AssistantMessageComponent);
	finishedCache.installFinishedRenderCache(AssistantMessageComponent, undefined);
	debounce.setAssistantUpdateRenderRequester(() => void renders++);

	const full = "The quick brown fox jumps over the lazy dog. ".repeat(12).trim();
	const message = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: full }] };
	streaming.beginAssistantStream(message);
	const component = new AssistantMessageComponent(undefined, true);
	component.updateContent(message);
	const text = () => plain(component.render(80).join("\n")).replace(/\x1b\][^\x07]*\x07/g, "").replace(/[┊•\s]+/g, " ").trim();
	counted = component;
	advance(FRAME); // presentation tick: the whole message reaches the inner chain
	component.render(80);
	advance(FRAME * 2);
	const mid = text();
	expect("component shows a growing prefix mid-stream", mid.length > 0 && !mid.endsWith(full.slice(-20)), `${mid.length}/${full.length}`);
	advance(FRAME * 6);
	expect("the presentation tick delivers the whole message at once (one pacing layer)", delegated === 1, `${delegated} delegate calls`);

	streaming.endAssistantStream();
	component.updateContent({ ...message });
	const during = component.render(80);
	expect("render is not cached while revealing", component.render(80) !== during);
	for (let t = 0; t <= 300 && reveal.isRevealing(component); t += FRAME) {
		advance(FRAME);
		component.render(80);
	}
	component.render(80);
	expect("finished at the end", text().includes(full.slice(-20)) && !reveal.isRevealing(component));
	expect("finished render is cached again", component.render(80) === component.render(80));
}

// ── cost per frame on a long answer (~3k words with code blocks) ──
{
	const paragraph = "Streaming answers should reveal smoothly, with `inline code`, **bold** text and a [link](https://example.com) to read. ";
	const code = "```ts\nfor (let i = 0; i < 10; i++) {\n  console.log(i, 'value');\n}\n```\n\n";
	const long = Array.from({ length: 60 }, (_, i) => `${paragraph.repeat(3)}\n\n${i % 3 === 0 ? code : ""}`).join("");
	const message = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: long }] };
	// The rows the TUI hands to the reveal: the full render of the answer (a finished component, nothing is cut).
	const rendered = new AssistantMessageComponent(message, true);
	const rows = rendered.render(100);

	// Cursor sweeps the whole answer in ~1ms steps; every frame gets fresh row strings (worst case for the length cache).
	const component = liveComponent();
	reveal.revealBody(component, rows);
	const sweep = [];
	const steady = [];
	for (let i = 0; i < 600; i++) {
		advance(1);
		const fresh = rows.map((row) => ` ${row}`.slice(1));
		const start = performance.now();
		const shown = reveal.revealBody(component, fresh);
		(shown.length === rows.length && i > 450 ? steady : sweep).push(performance.now() - start);
	}
	streaming.endAssistantStream();
	advance(1000);
	const sorted = (list) => [...list].sort((a, b) => a - b);
	const stat = (list) => list.length === 0 ? "no frames" : `median ${sorted(list)[list.length >> 1].toFixed(2)}ms p95 ${sorted(list)[Math.floor(list.length * 0.95)].toFixed(2)}ms max ${sorted(list).at(-1).toFixed(2)}ms`;
	console.log(`reveal cost per frame, ${long.split(/\s+/).length} words / ${rows.length} rows: revealing ${stat(sweep)} (${sweep.length} frames) | caught up ${stat(steady)}`);
	expect("reveal costs well under 4ms per frame", sweep.length > 0 && steady.length > 0 && sorted(sweep)[Math.floor(sweep.length * 0.95)] < 4 && sorted(steady)[steady.length >> 1] < 4);
}

if (failures.length > 0) {
	console.error(`reveal smoke FAILED (${failures.length}):`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("reveal smoke ok");
process.exit(0);
