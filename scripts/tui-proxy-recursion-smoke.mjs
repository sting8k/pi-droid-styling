#!/usr/bin/env node
/**
 * Smoke test: TUI method patches are safe under the Pi 0.84 InteractiveMode
 * proxy (`createInteractiveTuiReference`).
 *
 * Background: the proxy `get` returns a fresh dynamic wrapper on every access
 * that re-reads the current renderer's method at call time, and `set` writes to
 * the current renderer. Capturing `tui.doRender.bind(tui)` therefore pins that
 * dynamic re-reader, which bounces back into any installed wrapper
 * (`RangeError: Maximum call stack size exceeded`). The installers must capture
 * the real method from the renderer prototype and invoke it with the runtime
 * `this` instead.
 *
 * This test builds a faithful Pi proxy, installs the updated wrappers through
 * it, and drives the real renderer methods to assert no recursion.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const buildDir = join(repoRoot, ".pi", "tui-proxy-recursion-build");

function fsReadDir(dir) {
	const result = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".pi" || entry.name === ".git") continue;
			result.push(...fsReadDir(full));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			result.push(full);
		}
	}
	return result;
}

function compileSources() {
	rmSync(buildDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install first");
	const files = fsReadDir(repoRoot);
	const result = spawnSync(process.execPath, [
		tsc,
		"--outDir", buildDir,
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--target", "ES2022",
		"--skipLibCheck",
		"--allowSyntheticDefaultImports",
		"--esModuleInterop",
		"--noImplicitAny", "false",
		...files,
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
}

async function importBuilt(relativePath) {
	return import(pathToFileURL(join(buildDir, relativePath)).href);
}

// Pi 0.84 createInteractiveTuiReference, reproduced faithfully.
function createInteractiveTuiReference(getTui) {
	return new Proxy({}, {
		get: (_target, property) => {
			const tui = getTui();
			const value = Reflect.get(tui, property, tui);
			if (typeof value !== "function") return value;
			return (...args) => {
				const tui = getTui();
				const method = Reflect.get(tui, property, tui);
				if (typeof method !== "function") throw new TypeError(`TUI property ${String(property)} is not callable`);
				return Reflect.apply(method, tui, args);
			};
		},
		set: (_target, property, value) => {
			const tui = getTui();
			return Reflect.set(tui, property, value, tui);
		},
		has: (_target, property) => Reflect.has(getTui(), property),
		getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
	});
}

// Real renderer with base methods on the prototype (mirrors TuiMainScreen).
class FakeRenderer {
	constructor({ columns = 100, rows = 30 } = {}) {
		this.previousLines = [];
		this.previousHeight = 0;
		this.previousViewportTop = 0;
		this.hardwareCursorRow = 0;
		this.terminal = { columns, rows, write: () => {} };
		this.renderCalled = 0;
		this.doRenderCalled = 0;
		this.applyLineResetsCalled = 0;
		this.requestRenderCalled = 0;
		this.children = []; // used by terminal-split/installFixedUserZone
	}
	render(width) {
		this.renderCalled++;
		return ["alpha", "bravo", "charlie"];
	}
	applyLineResets(lines) {
		this.applyLineResetsCalled++;
		return lines;
	}
	requestRender(force = false) {
		this.requestRenderCalled++;
		this.doRender();
	}
	doRender() {
		this.doRenderCalled++;
		const lines = this.render(this.terminal.columns);
		this.previousLines = this.applyLineResets(lines);
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}
function assertNoRecursion(fn, label) {
	let error = null;
	try {
		fn();
	} catch (caught) {
		error = caught;
	}
	assert(error === null, `${label} threw: ${error && error.stack ? error.stack.split("\n").slice(0, 4).join("\n") : error}`);
}

class LongRenderer extends FakeRenderer {
	render(width) {
		return ["x".repeat(width + 5)];
	}
}

let passed = 0;
function ok(label) {
	passed++;
	console.log(`  ✓ ${label}`);
}

compileSources();

const [physicalSync, throttle, autowrap, widthGuard, frameBackground, frameDebug, padding, fixedInstall] = await Promise.all([
	importBuilt("performance/render-physical-sync.js"),
	importBuilt("performance/render-throttle.js"),
	importBuilt("performance/render-autowrap-guard.js"),
	importBuilt("performance/render-width-guard.js"),
	importBuilt("performance/render-frame-background.js"),
	importBuilt("performance/render-frame-debug.js"),
	importBuilt("tui-padding.js"),
	importBuilt("fixed-zone/install.js"),
]);

const { installRenderPhysicalSync } = physicalSync;
const { installRenderThrottle } = throttle;
const { installRenderAutowrapGuard } = autowrap;
const { installRenderWidthGuard } = widthGuard;
const { installRenderFrameBackground } = frameBackground;
const { installRenderFrameDebug } = frameDebug;
const { installTuiPadding } = padding;
const { installFixedUserZone } = fixedInstall;

// Enable the env-gated installers so all wrappers are exercised.
process.env.PI_DROID_RENDER_AUTOWRAP_GUARD = "1";
process.env.PI_DROID_RENDER_DEBUG = "1";
process.env.PI_DROID_RENDER_FRAME_BG = "1";
process.env.PI_DROID_RENDER_FULL_REPAINT = "1";
process.env.PI_DROID_RENDER_SHAPE_REPAINT = "1";
process.env.PI_DROID_RENDER_DEBUG_DIR = join(buildDir, "debug");

function installAllWrappers(tui) {
	installRenderThrottle(tui, 29);
	installTuiPadding(tui);
	installRenderAutowrapGuard(tui);
	installRenderWidthGuard(tui);
	installRenderFrameBackground(tui, {});
	installRenderPhysicalSync(tui);
	installRenderFrameDebug(tui);
}

// ---------------------------------------------------------------------------
// 1. Proxy path (Pi 0.84): install through the proxy, drive the real renderer.
// ---------------------------------------------------------------------------
console.log("Proxy path (Pi 0.84):");
{
	const renderer = new FakeRenderer();
	let current = renderer;
	const tui = createInteractiveTuiReference(() => current);

	installAllWrappers(tui);

	// The proxy `set` wrote wrappers onto the real renderer.
	assert(typeof renderer.doRender === "function" && renderer.doRender.name !== "doRender", "doRender was wrapped through the proxy");
	assert(typeof renderer.render === "function" && renderer.render.name !== "render", "render was wrapped through the proxy");
	assert(typeof renderer.requestRender === "function" && renderer.requestRender.name !== "requestRender", "requestRender was wrapped through the proxy");
	assert(typeof renderer.applyLineResets === "function" && renderer.applyLineResets.name !== "applyLineResets", "applyLineResets was wrapped through the proxy");

	// Drive the REAL renderer methods (as Pi does) and assert no recursion.
	assertNoRecursion(() => renderer.doRender(), "renderer.doRender()");
	ok("renderer.doRender() no recursion");
	assertNoRecursion(() => renderer.render(100), "renderer.render()");
	ok("renderer.render() no recursion");
	assertNoRecursion(() => renderer.applyLineResets(["x", "y"]), "renderer.applyLineResets()");
	ok("renderer.applyLineResets() no recursion");
	assertNoRecursion(() => renderer.requestRender(true), "renderer.requestRender()");
	ok("renderer.requestRender() no recursion");

	// Also drive through the proxy (as Pi calls this.ui.*).
	assertNoRecursion(() => tui.doRender(), "proxy tui.doRender()");
	ok("proxy tui.doRender() no recursion");
	assertNoRecursion(() => tui.render(100), "proxy tui.render()");
	ok("proxy tui.render() no recursion");
	assertNoRecursion(() => tui.requestRender(true), "proxy tui.requestRender()");
	ok("proxy tui.requestRender() no recursion");
	assertNoRecursion(() => tui.applyLineResets(["p", "q"]), "proxy tui.applyLineResets()");
	ok("proxy tui.applyLineResets() no recursion");

	// Renderer switch: the proxy follows the current renderer; reinstall on the
	// new renderer must stay proxy-safe and idempotent.
	const renderer2 = new FakeRenderer();
	current = renderer2;
	installAllWrappers(tui);
	assertNoRecursion(() => renderer2.doRender(), "renderer2.doRender() after switch");
	assertNoRecursion(() => renderer2.render(80), "renderer2.render() after switch");
	assertNoRecursion(() => renderer2.applyLineResets(["a"]), "renderer2.applyLineResets() after switch");
	assertNoRecursion(() => renderer2.requestRender(true), "renderer2.requestRender() after switch");
	ok("renderer switch + reinstall no recursion");
}

// ---------------------------------------------------------------------------
// 2. Real (non-proxy) path (pre-0.84): install on the renderer directly.
// ---------------------------------------------------------------------------
console.log("Real renderer path (pre-0.84):");
{
	const renderer = new FakeRenderer();
	installAllWrappers(renderer);
	assertNoRecursion(() => renderer.doRender(), "real renderer.doRender()");
	assertNoRecursion(() => renderer.render(100), "real renderer.render()");
	assertNoRecursion(() => renderer.applyLineResets(["a"]), "real renderer.applyLineResets()");
	assertNoRecursion(() => renderer.requestRender(true), "real renderer.requestRender()");
	ok("real renderer methods no recursion");
}

// ---------------------------------------------------------------------------
// 3. Fixed-zone compositor through the proxy (TerminalSplitCompositor).
// ---------------------------------------------------------------------------
console.log("Fixed-zone compositor path (Pi 0.84):");
{
	const renderer = new FakeRenderer();
	renderer.children = [
		{ render: () => ["child0"] }, // 0: not a fixed-zone index
		{ render: () => ["child1"] },
		{ render: () => ["child2"] },
		{ render: () => ["child3"] }, // index 3: fixed-zone child -> hidden
	];
	let current = renderer;
	const tui = createInteractiveTuiReference(() => current);
	const sessionUi = {};

	const install = installFixedUserZone(sessionUi, tui, {
		enabled: true,
		visibleChatTail: 2,
		scrollFrameMs: 20,
		requestScrollRender: () => {},
		getShortcutHintPrefix: () => null,
		theme: {},
		userZoneStyle: undefined,
		sidebar: { enabled: false },
		onCopySelection: () => {},
	});
	assert(typeof install === "function", "fixed-user-zone installed");

	assertNoRecursion(() => renderer.doRender(), "compositor renderer.doRender()");
	ok("compositor renderer.doRender() no recursion");
	assertNoRecursion(() => renderer.render(100), "compositor renderer.render()");
	ok("compositor renderer.render() no recursion");
	assertNoRecursion(() => renderer.requestRender(true), "compositor renderer.requestRender()");
	ok("compositor renderer.requestRender() no recursion");

	// Dispose restores the base methods without recursion on subsequent renders.
	install();
	assertNoRecursion(() => renderer.doRender(), "compositor renderer.doRender() after dispose");
	assertNoRecursion(() => renderer.render(100), "compositor renderer.render() after dispose");
	ok("compositor dispose + re-render no recursion");
}

// ---------------------------------------------------------------------------
// 4. Fullscreen layout padding (Pi 0.84 TuiAltScreen). Fullscreen bypasses
//    TUI.render(), so padding must wrap the persistent layout root instead.
// ---------------------------------------------------------------------------
console.log("Fullscreen layout padding path (Pi 0.84):");
{
	const layoutNode = Symbol.for("@earendil-works/pi-tui/layout-node");
	const originalNode = { type: "vstack", entries: [], gap: 0, align: "stretch" };
	const root = {
		render: () => ["content"],
		invalidate: () => {},
		[layoutNode]: () => originalNode,
	};
	const renderer = new FakeRenderer();
	renderer.mode = "fullscreen";
	renderer.layoutRoot = root;
	renderer.setLayoutRoot = (nextRoot) => { renderer.layoutRoot = nextRoot; };
	const tui = createInteractiveTuiReference(() => renderer);

	installTuiPadding(tui);
	const paddedNode = root[layoutNode]();
	assert(paddedNode.type === "hstack", `fullscreen padding should wrap the root in an hstack, got ${paddedNode.type}`);
	assert(paddedNode.entries.length === 3, `fullscreen padding should create left/content/right entries, got ${paddedNode.entries.length}`);
	assert(paddedNode.entries[0].basis === 1 && paddedNode.entries[2].basis === 1, "fullscreen padding should keep one-column gutters");
	assert(paddedNode.entries[1].component[layoutNode]() === originalNode, "fullscreen padding should preserve the original root layout node");

	const installedLayoutNode = root[layoutNode];
	installTuiPadding(tui);
	assert(root[layoutNode] === installedLayoutNode, "fullscreen padding reinstall should not stack wrappers");
	ok("fullscreen layout keeps one-column gutters without double wrapping");
}

// ---------------------------------------------------------------------------
// 5. Chain preservation: padding -> widthGuard on the Pi proxy. The second
//    wrapper must chain to the first (padding) wrapper, not skip to base.
// ---------------------------------------------------------------------------
console.log("Chain preservation (padding -> widthGuard, Pi proxy):");
{
	const renderer = new LongRenderer();
	const tui = createInteractiveTuiReference(() => renderer);
	installTuiPadding(tui);
	installRenderWidthGuard(tui);
	const line = renderer.render(10)[0];
	assert(typeof line === "string" && line.length === 10, `padding+widthGuard should yield exactly 10 visible chars, got ${JSON.stringify(line)}`);
	assert(line.startsWith(" "), `line should still start with the TUI padding space (chain preserved), got ${JSON.stringify(line)}`);
	ok("padding -> widthGuard chain preserved (padded + width-clamped)");
}

// ---------------------------------------------------------------------------
// 6. Chain preservation: physicalSync -> frameDebug on the Pi proxy. The debug
//    wrapper must chain to the physical-sync wrapper so its self-heal still runs.
// ---------------------------------------------------------------------------
console.log("Chain preservation (physicalSync -> frameDebug, Pi proxy):");
{
	const renderer = new FakeRenderer();
	renderer.previousLines = ["seed"];
	renderer.previousHeight = 5;
	renderer.previousViewportTop = 0;
	renderer.hardwareCursorRow = 1;
	const writes = [];
	renderer.terminal.write = (data) => { writes.push(String(data)); };
	const tui = createInteractiveTuiReference(() => renderer);
	installTuiPadding(tui);
	installRenderWidthGuard(tui);
	installRenderPhysicalSync(tui);
	installRenderFrameDebug(tui);
	renderer.doRender();
	assert(writes.some((w) => w.includes("\x1b[?2026h")), "physicalSync self-heal repaint should still run under frameDebug (chain not bypassed)");
	assert(renderer.doRenderCalled > 0, "physicalSync -> base doRender ran");
	ok("physicalSync -> frameDebug chain preserved (self-heal repaint written)");
}

console.log(`\nPASS: ${passed} assertions, no recursion, chain preserved`);

// Clean up after ourselves.
rmSync(buildDir, { recursive: true, force: true });