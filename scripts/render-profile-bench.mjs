#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

process.env.PI_DROID_PROFILE = process.env.PI_DROID_PROFILE || "1";
process.env.PI_DROID_PROFILE_INTERVAL_MS = process.env.PI_DROID_PROFILE_INTERVAL_MS || "60000";
process.env.PI_DROID_PROFILE_OUT = process.env.PI_DROID_PROFILE_OUT || join(tmpdir(), `pi-droid-render-profile-${Date.now()}.jsonl`);

const repoRoot = process.cwd();
const buildDir = join(repoRoot, ".pi", "profile-bench-build");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iterations = Math.max(1, Number(process.env.PI_DROID_PROFILE_BENCH_ITERATIONS || 120));

function collectTsFiles(dir) {
	const ignored = new Set([".git", ".memory", ".pi", "node_modules"]);
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (ignored.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(path));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(relative(repoRoot, path));
		}
	}
	return files;
}

function compileSources() {
	rmSync(buildDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run profile:render");
	const files = collectTsFiles(repoRoot);
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

compileSources();

const [profiler, gitStatus, renderThrottle, assistantDebounce, toolDebounce, streamingMarkdownCache, finishedRenderCache] = await Promise.all([
	importBuilt("performance/profiler.js"),
	importBuilt("core/git-status.js"),
	importBuilt("performance/render-throttle.js"),
	importBuilt("performance/debounce-update.js"),
	importBuilt("performance/debounce-tool-updates.js"),
	importBuilt("messages/streaming-markdown-cache.js"),
	importBuilt("performance/finished-render-cache.js"),
]);

const { flushProfile, profileCount, profileSample } = profiler;
const { createGitBranchFetcher } = gitStatus;
const { installRenderThrottle } = renderThrottle;
const { installAssistantUpdateDebounce, setAssistantUpdateRenderRequester } = assistantDebounce;
const { installToolExecutionUpdateDebounce } = toolDebounce;
const { installAssistantStreamingMarkdownCache } = streamingMarkdownCache;
const { installFinishedRenderCache } = finishedRenderCache;
const { AssistantMessageComponent, ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");

let throttledDispatches = 0;
const throttledTui = { requestRender: () => { throttledDispatches++; } };
installRenderThrottle(throttledTui, 10);
for (let i = 0; i < 50; i++) throttledTui.requestRender(i % 17 === 0);
await sleep(30);
profileSample("bench.throttledDispatches", throttledDispatches);

class FakeAssistantMessage {
	updates = 0;
	updateContent(message) {
		this.updates++;
		String(message?.text ?? "").toUpperCase();
	}
}
installAssistantUpdateDebounce(FakeAssistantMessage);
setAssistantUpdateRenderRequester(() => profileCount("bench.assistant.requestRender"));
const assistantComponent = new FakeAssistantMessage();
for (let i = 0; i < 40; i++) assistantComponent.updateContent({ text: `delta ${i}` });
await sleep(80);
assistantComponent.updateContent({ text: "done", stopReason: "end" });
profileSample("bench.assistantActualUpdates", assistantComponent.updates);

const cadenceAssistantComponent = new FakeAssistantMessage();
const cadenceDelays = [35, 35, 37, 38, 45, 45, 12, 12, 50, 50, 8, 8, 35, 37, 70, 45];
let cadenceText = "";
for (let i = 0; i < cadenceDelays.length; i++) {
	cadenceText += `word${i} `;
	cadenceAssistantComponent.updateContent({
		content: [{ type: "text", text: cadenceText }],
	});
	await sleep(cadenceDelays[i]);
}
await sleep(120);
cadenceAssistantComponent.updateContent({
	content: [{ type: "text", text: cadenceText }],
	stopReason: "end",
});
profileSample("bench.assistantCadenceInputUpdates", cadenceDelays.length + 1);
profileSample("bench.assistantCadenceActualUpdates", cadenceAssistantComponent.updates);

const largeChunkAssistantComponent = new FakeAssistantMessage();
const largeChunkText = `${"large chunk paragraph. ".repeat(80)}\n\n${"second paragraph keeps flowing. ".repeat(60)}`;
largeChunkAssistantComponent.updateContent({ content: [{ type: "text", text: "Intro." }] });
await sleep(45);
largeChunkAssistantComponent.updateContent({ content: [{ type: "text", text: `Intro.\n\n${largeChunkText}` }] });
await sleep(420);
largeChunkAssistantComponent.updateContent({ content: [{ type: "text", text: `Intro.\n\n${largeChunkText}` }], stopReason: "end" });
profileSample("bench.assistantLargeChunkActualUpdates", largeChunkAssistantComponent.updates);

installAssistantStreamingMarkdownCache(AssistantMessageComponent);
installAssistantUpdateDebounce(AssistantMessageComponent);
installFinishedRenderCache(AssistantMessageComponent, ToolExecutionComponent);
const benchMarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: (text) => text,
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => text,
	quoteBorder: (text) => text,
	hr: (text) => text,
	listBullet: (text) => text,
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};
const markdownStreamingComponent = new AssistantMessageComponent(
	{ content: [{ type: "text", text: "Intro paragraph." }] },
	false,
	benchMarkdownTheme,
);
const markdownStreamingTexts = [
	"Intro paragraph.",
	"Intro paragraph.\n\nSecond paragraph starts",
	"Intro paragraph.\n\nSecond paragraph starts and grows",
	"Intro paragraph.\n\nSecond paragraph starts and grows.\n\nThird paragraph starts",
	"Intro paragraph.\n\nSecond paragraph starts and grows.\n\nThird paragraph starts with `inline code`",
	"Intro paragraph.\n\nSecond paragraph starts and grows.\n\n```ts\nconst value = 1;",
	"Intro paragraph.\n\nSecond paragraph starts and grows.\n\n```ts\nconst value = 1;\n```\n\nAfter code fence",
];
for (const text of markdownStreamingTexts) {
	markdownStreamingComponent.updateContent({ content: [{ type: "text", text }] });
	await sleep(40);
	markdownStreamingComponent.render(88);
}
markdownStreamingComponent.updateContent({
	content: [{ type: "text", text: markdownStreamingTexts.at(-1) }],
	stopReason: "end",
});
markdownStreamingComponent.render(88);
markdownStreamingComponent.render(88);
markdownStreamingComponent.render(88);
profileSample("bench.markdownStreamingInputUpdates", markdownStreamingTexts.length + 2);

class FakeToolExecution {
	updates = 0;
	ui = { requestRender: () => profileCount("bench.tool.requestRender") };
	updateResult(result, isPartial = false) {
		this.updates++;
		String(result?.output ?? "").slice(0, isPartial ? 100 : 200);
	}
}
installToolExecutionUpdateDebounce(FakeToolExecution);
const toolComponent = new FakeToolExecution();
for (let i = 0; i < 40; i++) toolComponent.updateResult({ output: `partial ${i}\n${"y".repeat(200)}` }, true);
await sleep(100);
toolComponent.updateResult({ output: "final" }, false);
profileSample("bench.toolActualUpdates", toolComponent.updates);

const fetchBranch = createGitBranchFetcher(repoRoot, () => profileCount("bench.git.onUpdate"));
fetchBranch();
await sleep(1200);
for (let i = 0; i < 20; i++) fetchBranch();

profileCount("bench.done");
flushProfile("bench");

rmSync(buildDir, { recursive: true, force: true });

console.log(JSON.stringify({
	profileOut: process.env.PI_DROID_PROFILE_OUT,
	iterations,
	throttledDispatches,
}, null, 2));
