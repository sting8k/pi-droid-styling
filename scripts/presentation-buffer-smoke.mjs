#!/usr/bin/env node
/**
 * US-025 presentation-buffer / finished-cache smoke.
 *
 * Drives the real Pi 0.78 AssistantMessageComponent with `installAssistantUpdateDebounce` and
 * `installFinishedRenderCache` installed in the same order index.ts uses, on top of a spy that
 * records every delegate (`orig`) call. Stream state comes from the real
 * messages/assistant-streaming-state.ts seam.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "presentation-buffer-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const failures = [];
async function check(name, fn) {
	try {
		await fn();
	} catch (error) {
		failures.push(`${name}: ${error?.message ?? error}`);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripAnsi = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const textOf = (message) => message?.content?.[0]?.text ?? "";

async function waitUntil(predicate, maxTicks = 40) {
	for (let i = 0; i < maxTicks; i++) {
		if (predicate()) return true;
		await sleep(35);
	}
	return predicate();
}

function prepareBuild() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding: string) => string;
	export const readdirSync: any;
	export const appendFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "node:fs" {
	export * from "fs";
}
declare module "node:buffer" {
	export const Buffer: any;
}
declare module "node:perf_hooks" {
	export const monitorEventLoopDelay: any;
	export const performance: any;
}
declare const process: any;
declare const setInterval: any;
declare const clearInterval: any;
declare const setTimeout: any;
declare const clearTimeout: any;
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
		"--lib", "ES2022",
		stubPath,
		join(repoRoot, "messages", "assistant-streaming-state.ts"),
		join(repoRoot, "performance", "profiler.ts"),
		join(repoRoot, "performance", "debounce-update.ts"),
		join(repoRoot, "performance", "finished-render-cache.ts"),
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`tsc failed\n${result.stdout}\n${result.stderr}`);
}

prepareBuild();

const streamingState = await import(pathToFileURL(join(buildDir, "messages", "assistant-streaming-state.js")).href);
const debounce = await import(pathToFileURL(join(buildDir, "performance", "debounce-update.js")).href);
const finishedCache = await import(pathToFileURL(join(buildDir, "performance", "finished-render-cache.js")).href);

const { initTheme, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");

// Spy the delegate before the wrappers capture it, so `calls` records every orig call.
const calls = [];
const baseUpdateContent = AssistantMessageComponent.prototype.updateContent;
AssistantMessageComponent.prototype.updateContent = function spyUpdateContent(message) {
	calls.push(message);
	return baseUpdateContent.call(this, message);
};
debounce.installAssistantUpdateDebounce(AssistantMessageComponent);
finishedCache.installFinishedRenderCache(AssistantMessageComponent, undefined);

const resetCalls = () => {
	calls.length = 0;
};
const partialWith = (text, stopReason = "stop") => ({ role: "assistant", stopReason, content: [{ type: "text", text }] });
const activePartial = (text) => ({ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] });

await check("B1 drip: a real partial is drip-fed, not delivered whole", async () => {
	resetCalls();
	const partial = partialWith("a".repeat(600));
	streamingState.beginAssistantStream(partial);
	try {
		const component = new AssistantMessageComponent(undefined, true);
		component.updateContent(partial);
		assert(calls.length === 0, "streaming update must not call orig synchronously");
		await sleep(40);
		assert(calls.length >= 1, "a presentation tick should have revealed a chunk");
		assert(calls[0] !== partial, "buffered reveal must pass a clone, not the source object");
		assert(textOf(calls[0]).length > 0 && textOf(calls[0]).length < 600, `first reveal should be partial: ${textOf(calls[0]).length}`);
		await waitUntil(() => textOf(calls.at(-1)) === "a".repeat(600));
		assert(textOf(calls.at(-1)) === "a".repeat(600), "displayed text should converge to the full source");
		assert(calls.length > 1, "a large chunk should take several ticks");
	} finally {
		streamingState.endAssistantStream();
	}
});

await check("B2 non-streaming update is immediate and schedules no tick", async () => {
	resetCalls();
	const component = new AssistantMessageComponent(undefined, true);
	const stopped = partialWith("hello");
	component.updateContent(stopped);
	assert(calls.length === 1 && calls[0] === stopped, "non-streaming update must call orig synchronously with the same object");
	await sleep(60);
	assert(calls.length === 1, "no tick should be scheduled");

	resetCalls();
	const undefinedStopReason = { role: "assistant", content: [{ type: "text", text: "hello" }] };
	component.updateContent(undefinedStopReason);
	assert(calls.length === 1 && calls[0] === undefinedStopReason, "stopReason must no longer decide the branch");
	await sleep(60);
	assert(calls.length === 1, "no tick for an undefined stopReason either");
});

await check("B3 final flush cancels the pending tick", async () => {
	resetCalls();
	const partial = partialWith("b".repeat(600));
	streamingState.beginAssistantStream(partial);
	const component = new AssistantMessageComponent(undefined, true);
	component.updateContent(partial);
	assert(calls.length === 0, "buffer engaged before the final");
	streamingState.endAssistantStream();
	const final = partialWith("b".repeat(600));
	component.updateContent(final);
	assert(calls.length === 1 && calls[0] === final, "final update must flush synchronously with the original object");
	await sleep(90);
	assert(calls.length === 1, "the pending tick must be cancelled");
});

await check("B4 history components never enter the buffer", async () => {
	// (i) constructed while no stream is active, re-updated during a later stream
	resetCalls();
	const history = new AssistantMessageComponent(partialWith("history"), true);
	assert(calls.length === 1, "history construction is immediate");
	resetCalls();
	const streamMessage = activePartial("c".repeat(600));
	streamingState.beginAssistantStream(streamMessage);
	try {
		history.updateContent(history.lastMessage);
		assert(calls.length === 1 && calls[0] === history.lastMessage, "history re-render must take the immediate path");
		await sleep(60);
		assert(calls.length === 1, "history re-render must not schedule a tick");
	} finally {
		streamingState.endAssistantStream();
	}

	// (ii) constructed mid-stream with its own message object
	resetCalls();
	const midStreamMessage = activePartial("d".repeat(600));
	streamingState.beginAssistantStream(midStreamMessage);
	try {
		const rebuilt = new AssistantMessageComponent(partialWith("old"), true);
		assert(calls.length === 1, "a history component built mid-stream must not enter the buffer");
		await sleep(60);
		assert(calls.length === 1, "a history component built mid-stream must not schedule a tick");
		void rebuilt;
	} finally {
		streamingState.endAssistantStream();
	}
});

await check("B5 a small delta converges on the first tick", async () => {
	resetCalls();
	const message = activePartial("tiny");
	streamingState.beginAssistantStream(message);
	try {
		const component = new AssistantMessageComponent(undefined, true);
		component.updateContent(message);
		assert(calls.length === 0, "buffer engaged");
		await sleep(40);
		assert(calls.length === 1 && textOf(calls[0]) === "tiny", "small delta should converge on the first tick");
		await sleep(40);
		assert(calls.length === 1, "no extra ticks after convergence");
	} finally {
		streamingState.endAssistantStream();
	}
});

await check("B6 finished cache bypasses while streaming", async () => {
	resetCalls();
	const first = activePartial("alpha");
	streamingState.beginAssistantStream(first);
	try {
		const component = new AssistantMessageComponent(undefined, true);
		component.updateContent(first);
		await waitUntil(() => textOf(component.lastMessage) === "alpha");
		const before = component.render(80);

		// Mutate the tracked message in place; the finished cache keys its signature by source
		// identity, so without the bypass the second render would return the cached array.
		component.lastMessage.content[0].text = "alpha-mutated";
		const after = component.render(80);
		assert(before !== after, "renders during the stream must not be served from a cache");

		component.updateContent(component.lastMessage);
		await waitUntil(() => stripAnsi(component.render(80).join("\n")).includes("alpha-mutated"));
		const reflected = component.render(80);
		assert(stripAnsi(reflected.join("\n")).includes("alpha-mutated"), `render must reflect the mutated lastMessage: ${JSON.stringify(reflected.map(stripAnsi))}`);
	} finally {
		streamingState.endAssistantStream();
	}

	const componentAfter = new AssistantMessageComponent(undefined, true);
	componentAfter.updateContent(partialWith("done"));
	const cachedFirst = componentAfter.render(80);
	const cachedSecond = componentAfter.render(80);
	assert(cachedFirst === cachedSecond, "after the stream ends the finished cache must return the same instance");
});

await check("B7 disposal: a stale pending tick does not call the requester", async () => {
	resetCalls();
	let requesterCalls = 0;
	debounce.setAssistantUpdateRenderRequester(() => {
		requesterCalls++;
	});
	const message = activePartial("e".repeat(120));
	streamingState.beginAssistantStream(message);
	try {
		const component = new AssistantMessageComponent(undefined, true);
		component.updateContent(message);
		assert(calls.length === 0, "buffer engaged");
		debounce.setAssistantUpdateRenderRequester(undefined);
		await sleep(90);
		assert(requesterCalls === 0, "a disposed requester must not be called");
	} finally {
		debounce.setAssistantUpdateRenderRequester(undefined);
		streamingState.endAssistantStream();
	}
	resetCalls();
});

if (failures.length > 0) {
	console.error(`presentation buffer smoke FAILED (${failures.length}):`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("presentation buffer smoke ok");
