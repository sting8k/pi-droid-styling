#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { setKeybindings, KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "image-attachments-smoke");
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
	export const readFileSync: (path: string, encoding?: string) => any;
	export const readdirSync: (path: string, options?: { withFileTypes?: boolean }) => any[];
	export const statSync: (path: string) => { mtimeMs: number; size: number };
	export const writeFileSync: (path: string, data: any, encoding?: string) => void;
	export const unlinkSync: (path: string) => void;
	export const renameSync: (from: string, to: string) => void;
}
declare module "node:fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding?: string) => any;
	export const readdirSync: (path: string, options?: { withFileTypes?: boolean }) => any[];
	export const statSync: (path: string) => { mtimeMs: number; size: number };
	export const writeFileSync: (path: string, data: any, encoding?: string) => void;
	export const unlinkSync: (path: string) => void;
	export const renameSync: (from: string, to: string) => void;
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const basename: (path: string) => string;
}
declare module "node:path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
	export const basename: (path: string) => string;
}
declare module "os" {
	export const homedir: () => string;
	export const tmpdir: () => string;
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:os" {
	export const homedir: () => string;
	export const tmpdir: () => string;
	export const hostname: () => string;
	export const userInfo: () => { username?: string };
}
declare module "node:url" {
	export const pathToFileURL: (url: string | URL) => URL;
}
declare const process: any;
declare type Buffer = any;
declare const Buffer: any;
`, "utf8");
}

function compileChangedSurface(outDir = buildDir) {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install first");
	const result = spawnSync(process.execPath, [
		tsc,
		"--outDir", outDir,
		"--rootDir", repoRoot,
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--target", "ES2022",
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		"editor/image-attachments.ts",
		"editor/image-submit.ts",
		"editor/box-editor.ts",
		"messages/user-prefix.ts",
		"config.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc focused ok");
}

async function importBuilt(relativePath, dir = buildDir) {
	importCounter += 1;
	return import(`${pathToFileURL(join(dir, relativePath)).href}?smoke=${importCounter}`);
}

async function importShared(relativePath, dir = buildDir) {
	return import(pathToFileURL(join(dir, relativePath)).href);
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

function makeHostClipboardImage(bytes = 8) {
	const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
	writeFileSync(filePath, Buffer.alloc(bytes, 7), "utf8");
	return filePath;
}

function tokenOf(text) {
	const match = /\[Image #(\d+)\]/.exec(text);
	assert(match !== null, `expected an [Image #N] token in ${JSON.stringify(text)}`);
	return { token: match[0], id: match[1] };
}

function makeTheme() {
	return {
		borderColor: (text) => text,
		selectList: {},
		fg: (color, text) => {
			if (color === "dim") return `\x1b[2m${text}\x1b[22m`;
			if (color === "accent") return `\x1b[32m${text}\x1b[39m`;
			return text;
		},
		bg: (_color, text) => text,
		getBgAnsi: () => "",
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
		inverse: (text) => text,
	};
}

// ---------------------------------------------------------------------------
// Unit: durable store, disk-seeded serial, startup sweep, dual registry
// ---------------------------------------------------------------------------
async function runAttachmentUnitSmoke() {
	const unitHome = join(workDir, "home-unit");
	const storeDir = join(unitHome, ".pi", "agent", "sessions", "--unit--", "images");
	mkdirSync(storeDir, { recursive: true });
	process.env.HOME = unitHome;
	process.env.USERPROFILE = unitHome;

	// Seed the store BEFORE the first registry touches it: ids 1..50 are 8 days old (must be
	// swept), ids 51..102 are fresh (must survive), so the first scan exercises the age sweep
	// and seeds the serial from disk.
	const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
	for (let i = 1; i <= 102; i += 1) {
		const file = join(storeDir, `${i}.png`);
		writeFileSync(file, Buffer.alloc(4, i % 256), "utf8");
		if (i <= 50) utimesSync(file, eightDaysAgo, eightDaysAgo);
	}

	const mod = await importBuilt("editor/image-attachments.js");
	const {
		ImageAttachmentList,
		isHostClipboardImagePath,
		isCommandLikeInput,
		resolveImageTokens,
		replaceImageTokensWithPaths,
		attachmentToImageContent,
		getGlobalImageLink,
		setImageStoreDir,
	} = mod;
	setImageStoreDir(storeDir);

	// Path gating.
	const good = makeHostClipboardImage();
	assert(isHostClipboardImagePath(good), "host clipboard image path should be recognized");
	assert(!isHostClipboardImagePath(join(tmpdir(), "notes.txt")), "non-image extension rejected");
	assert(!isHostClipboardImagePath(join(workDir, `pi-clipboard-${randomUUID()}.png`)), "paths outside tmpdir rejected");
	assert(!isHostClipboardImagePath(""), "empty path rejected");

	// Command gating.
	assert(isCommandLikeInput("/model"), "slash command gates image submit");
	assert(isCommandLikeInput("  !ls -la"), "bash mode gates image submit");
	assert(!isCommandLikeInput("what is this screenshot"), "plain text does not gate");

	// First construction = process startup: age sweep + serial seed + link-table rebuild.
	const list = new ImageAttachmentList();
	assert(!existsSync(join(storeDir, "1.png")) && !existsSync(join(storeDir, "50.png")), "age sweep removes files older than the retention window");
	assert(existsSync(join(storeDir, "51.png")) && existsSync(join(storeDir, "102.png")), "age sweep keeps fresh files");
	assert(list.count() === 16, "edit registry restores the newest 16");
	assert(list.list()[0].id === "87" && list.list()[15].id === "102", "registry window is the newest end");
	assert(getGlobalImageLink("51") === join(storeDir, "51.png"), "link table rebuilt from disk");
	assert(getGlobalImageLink("1") === undefined, "swept ids have no link");
	assert(getGlobalImageLink("87") !== undefined, "evicted-from-registry ids keep their link");

	// Paste continues the serial from disk — never reusing an id.
	const attachment = list.addFromPath(good);
	assert(attachment !== null && attachment.id === "103", "serial seeded from disk (max 102 + 1)");
	assert(!existsSync(good), "host tmp file deleted after persist");
	assert(existsSync(attachment.path), "persisted copy exists");
	assert(attachment.path === join(storeDir, "103.png"), "persisted path follows the <id>.<ext> convention");
	assert(attachment.mimeType === "image/png" && attachment.bytes === 8, "mime and size recorded");
	assert(list.count() === 16, "registry stays capped after the paste");

	// A second registry (replacement editor / resume) sees the same store.
	const restored = new ImageAttachmentList();
	assert(restored.list().some((item) => item.id === "103"), "second registry restores the new paste");

	// Token resolution (dynamic ids).
	const inline = resolveImageTokens("look at [Image #103] please", restored.list());
	assert(inline.cleanText === "look at please", "inline token collapsed with single spacing");
	assert(inline.referenced.length === 1 && inline.referenced[0].id === "103", "inline token resolves");
	assert(inline.orphans.length === restored.count() - 1, "unreferenced entries are orphans");

	const ownLine = resolveImageTokens("header\n[Image #102]\n[Image #103]\nfooter", restored.list());
	assert(ownLine.cleanText === "header\nfooter", "token-only lines dropped entirely");
	assert(ownLine.referenced.length === 2, "both tokens resolve");

	const unknown = resolveImageTokens("compare [Image #103] with [Image #999]", restored.list());
	assert(unknown.cleanText === "compare with [Image #999]", "unknown token stays literal");
	assert(unknown.referenced.length === 1, "only live tokens resolve");

	const dup = resolveImageTokens("[Image #103] and [Image #103] again", restored.list());
	assert(dup.referenced.length === 1, "duplicate references dedupe");

	// Inline path replacement for the degraded branch.
	const replaced = replaceImageTokensWithPaths("see [Image #103] and [Image #999]", restored.list());
	assert(replaced === `see ${join(storeDir, "103.png")} and [Image #999]`, "hits replaced inline, unknowns kept");

	// Payload: reads the persisted bytes.
	const content = attachmentToImageContent(restored.list().find((item) => item.id === "103"));
	assert(content !== null && content.type === "image", "attachment converts to ImageContent");
	assert(content.data === Buffer.alloc(8, 7).toString("base64"), "payload matches the persisted bytes");
	assert(content.mimeType === "image/png", "payload keeps the mime type");
	console.log("attachment unit smoke ok");
}

// ---------------------------------------------------------------------------
// Submit policy (Pi `input` event): multimodal vs degraded
// ---------------------------------------------------------------------------
async function runImageSubmitSmoke() {
	const { attachEditorImages } = await importBuilt("editor/image-submit.js");
	const { ImageAttachmentList } = await importShared("editor/image-attachments.js");

	const list = new ImageAttachmentList();
	const attached = list.addFromPath(makeHostClipboardImage(1024));
	assert(attached !== null, "submit fixture attaches");
	const token = `[Image #${attached.id}]`;

	// Multimodal model: text keeps its token, base64 image parts are appended to any existing images.
	const rich = attachEditorImages(`look at ${token} this`, undefined, [attached], ["text", "image"]);
	assert(rich.action === "transform" && rich.text === `look at ${token} this`, "text keeps the positional token");
	assert(rich.images.length === 1 && rich.images[0].data === readFileSync(attached.path).toString("base64"), "image part carries the persisted bytes");
	const existing = { type: "image", data: "AAAA", mimeType: "image/png" };
	const merged = attachEditorImages(`x ${token}`, [existing], [attached], ["text", "image"]);
	assert(merged.images.length === 2 && merged.images[0] === existing, "images already on the input are kept first");

	// Text-only model: token replaced by the persisted path inline.
	const textOnly = attachEditorImages(`look at ${token} this`, undefined, [attached], ["text"]);
	assert(textOnly.action === "transform" && textOnly.text === `look at ${attached.path} this` && textOnly.images === undefined, "text-only degrade replaces the token inline");

	// Unknown modalities (stale context): same degradation.
	const stale = attachEditorImages(`x ${token}`, undefined, [attached], undefined);
	assert(stale.text === `x ${attached.path}`, "unknown modalities degrade to inline path text");

	// No live token, or a command: the host input goes through untouched.
	assert(attachEditorImages("just text [Image #999]", undefined, [attached], ["image"]).action === "continue", "no resolved token: continue");
	assert(attachEditorImages(`/skill:x ${token}`, undefined, [attached], ["image"]).action === "continue", "slash input: continue");

	// Multimodal model but the persisted file vanished: degrade instead of failing.
	rmSync(attached.path, { force: true });
	const vanished = attachEditorImages(`x ${token}`, undefined, [attached], ["text", "image"]);
	assert(vanished.text === `x ${attached.path}` && vanished.images === undefined, "vanished file degrades to inline path text");
	console.log("image submit smoke ok");
}

// ---------------------------------------------------------------------------
// BoxEditor integration: paste → token, native editing keys, hybrid submit,
// history re-send, restart restore
// ---------------------------------------------------------------------------
async function runBoxEditorIntegrationSmoke() {
	const homeDir = join(workDir, "home-main");
	mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
	writeFileSync(join(homeDir, ".pi", "agent", "pi-droid-styling.json"), '{"imageAttachments":true}\n', "utf8");
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const { BoxEditor } = await importBuilt("editor/box-editor.js");
	const { resolveUserZoneStyle } = await importBuilt("user-zone/designs.js");
	const { setFullTheme } = await importBuilt("theme/theme-extras.js");
	setFullTheme({ sourcePath: join(workDir, "theme.json") }, true);
	setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

	const { attachEditorImages } = await importShared("editor/image-submit.js");
	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const submissions = [];
	const submitSink = (text) => submissions.push(text);
	// What Pi's `input` event hands the model for a submitted text (index.ts wires the same call).
	const deliver = (editor, text) => attachEditorImages(text, undefined, editor.getImageAttachments(), ["text", "image"]);
	const sessionStore = join(homeDir, ".pi", "agent", "sessions", "--integration--", "images");

	const makeEditor = () => {
		const editor = new BoxEditor(
			tui,
			makeTheme(),
			{ matches: () => false },
			makeTheme(),
			workDir,
			() => ({ tokens: 1000, percent: 10, contextWindow: 48000 }),
			() => ({ provider: "test", id: "test-model", name: "Test Model", reasoning: false }),
			() => ({ branch: "main", insertions: 0, deletions: 0 }),
			() => 10,
			() => "ready",
			resolveUserZoneStyle("gemini"),
			undefined,
			undefined,
			sessionStore,
		);
		editor.onSubmit = submitSink;
		return editor;
	};

	// Paste diversion: token in text, tmp file consumed, persisted copy kept.
	const editor = makeEditor();
	editor.setText("");
	editor.insertTextAtCursor(makeHostClipboardImage(250880));
	const first = tokenOf(editor.getText());
	assert(editor.getText() === `${first.token} `, "pasted image inserts a text token at the cursor");
	const lines = editor.render(88).map(stripAnsi);
	assert(lines.some((line) => line.includes(first.token)), "token renders in the input area");
	assert(!lines.some((line) => line.includes("pi-clipboard")), "raw tmp path never renders");

	// Plain arrows stay with input history — no attachment routing intercepts them.
	editor.addToHistory("an older prompt");
	editor.setText("");
	editor.handleInput("\x1b[A");
	assert(editor.getText() === "an older prompt", "plain up recalls history, attachments or not");
	editor.setText("");

	// Backspace deletes a whole token in ONE stroke (atomic, like Claude Code chips).
	editor.insertTextAtCursor(makeHostClipboardImage(64));
	const atomic = tokenOf(editor.getText());
	assert(editor.getText() === `${atomic.token} `, "atomic fixture holds a fresh token");
	editor.handleInput("\x7f");
	assert(editor.getText() === "", "one backspace removes the entire token plus its trailing space");

	// Forward Delete removes a whole token sitting right after the cursor.
	editor.insertTextAtCursor(makeHostClipboardImage(64));
	const forward = tokenOf(editor.getText());
	editor.setText(`${forward.token} tail`);
	for (let i = 0; i < 30; i += 1) editor.handleInput("\x1b[D"); // cursor to line start
	editor.handleInput("\x1b[3~");
	assert(editor.getText() === "tail", `forward delete removes the leading token: ${JSON.stringify(editor.getText())}`);

	// A partial (edited) token stays plain text: backspace removes exactly one character.
	editor.setText(`broken ${forward.token.slice(0, -1)}x`);
	for (let i = 0; i < 30; i += 1) editor.handleInput("\x1b[C"); // move to end
	editor.handleInput("\x7f");
	assert(editor.getText() === `broken ${forward.token.slice(0, -1)}`, "partial token backspace stays character-wise");

	// Submit stays with the host: Enter hands the text (token included) to the host onSubmit, which
	// owns input history and queueing; the input event then attaches the image behind the token.
	const secondTmp = makeHostClipboardImage(1024);
	editor.insertTextAtCursor(secondTmp);
	const second = tokenOf(editor.getText());
	editor.setText(`look at ${second.token} closely`);
	editor.handleInput("\r");
	assert(submissions.length === 1 && submissions[0] === `look at ${second.token} closely`, "Enter goes through the host submit with the token kept");
	assert(editor.getText() === "", "editor clears after submit");
	const sent = deliver(editor, submissions[0]);
	assert(sent.action === "transform" && sent.text === submissions[0] && sent.images.length === 1, "input event attaches the image behind the token");
	const secondPath = join(sessionStore, `${second.id}.png`);
	assert(sent.images[0].data === readFileSync(secondPath).toString("base64"), "attached bytes come from the session store");
	assert(!existsSync(secondTmp), "host tmp file was consumed at paste time");

	// History re-send: recalled text re-resolves the same attachment.
	const resent = deliver(editor, `look at ${second.token} again`);
	assert(resent.images?.length === 1 && resent.images[0].data === sent.images[0].data, "recalled token re-sends the same image");

	// References deleted by the user, or a slash command: the input goes through untouched.
	editor.insertTextAtCursor(makeHostClipboardImage(256));
	assert(deliver(editor, "just text now").action === "continue", "deleted references attach nothing");
	assert(deliver(editor, `/model ${second.token}`).action === "continue", "slash command keeps the host path");

	// Restart restore: a replacement editor rebuilds its registry from the store, so a token
	// from the previous editor still resolves and re-sends.
	const editor2 = makeEditor();
	const restored = deliver(editor2, `resend ${second.token}`);
	assert(restored.images?.length === 1 && restored.images[0].data === sent.images[0].data, "restored registry re-sends the older image");
	console.log("box editor integration smoke ok");
}

// ---------------------------------------------------------------------------
// Process startup: the FIRST editor of a process must scan the session store it was given, and
// ids must stay unique after every older file has aged out.
// ---------------------------------------------------------------------------
async function runStartupStoreSmoke() {
	// Isolated build: the store state is module-level, so "first editor of the process" needs a
	// module graph no earlier pass has touched.
	const startupBuildDir = join(workDir, "build-startup");
	mkdirSync(startupBuildDir, { recursive: true });
	writeFileSync(join(startupBuildDir, "package.json"), '{"type":"module"}\n', "utf8");
	compileChangedSurface(startupBuildDir);

	const homeDir = join(workDir, "home-startup");
	writeInitialConfig(homeDir, '{"imageAttachments":true}');
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const store = join(homeDir, ".pi", "agent", "sessions", "--startup--", "images");
	mkdirSync(store, { recursive: true });
	for (const id of [1, 2, 3]) writeFileSync(join(store, `${id}.png`), `earlier-session-${id}`, "utf8");

	const { BoxEditor } = await importShared("editor/box-editor.js", startupBuildDir);
	const { resolveUserZoneStyle } = await importShared("user-zone/designs.js", startupBuildDir);
	const { setFullTheme } = await importShared("theme/theme-extras.js", startupBuildDir);
	setFullTheme({ sourcePath: join(workDir, "theme.json") }, true);
	setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const editor = new BoxEditor(tui, makeTheme(), { matches: () => false }, makeTheme(), workDir,
		undefined, undefined, undefined, undefined, undefined, resolveUserZoneStyle("gemini"), undefined, undefined, store);
	editor.insertTextAtCursor(makeHostClipboardImage(16));
	assert(tokenOf(editor.getText()).id === "4", `first paste of a process continues past the store's ids: ${editor.getText()}`);
	assert(readFileSync(join(store, "1.png"), "utf8") === "earlier-session-1", "an earlier session's image is never overwritten");
	assert(editor.getImageAttachments().some((item) => item.id === "3"), "the first editor restores the store it was given");

	// Every file aged out: the sweep keeps the newest, so the next process still seeds past it.
	const agedStore = join(homeDir, ".pi", "agent", "sessions", "--aged--", "images");
	mkdirSync(agedStore, { recursive: true });
	const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	for (const id of [5, 6, 7]) {
		writeFileSync(join(agedStore, `${id}.png`), "old", "utf8");
		utimesSync(join(agedStore, `${id}.png`), old, old);
	}
	const fresh = await importBuilt("editor/image-attachments.js", startupBuildDir); // private module instance = new process
	fresh.setImageStoreDir(agedStore);
	const list = new fresh.ImageAttachmentList();
	assert(!existsSync(join(agedStore, "5.png")) && !existsSync(join(agedStore, "6.png")), "aged files are swept");
	assert(existsSync(join(agedStore, "7.png")), "the newest file survives the sweep");
	const next = list.addFromPath(makeHostClipboardImage(8));
	assert(next !== null && next.id === "8", `ids are not reused after the sweep: got #${next?.id}`);
	console.log("startup store smoke ok");
}

// ---------------------------------------------------------------------------
// Feature disabled: byte-identical host behavior
// ---------------------------------------------------------------------------
async function runDisabledFeatureSmoke() {
	// Isolated build: BoxEditor patches close over module state from earlier passes, so the
	// disabled config must be the only one this module graph ever sees.
	const disabledBuildDir = join(workDir, "build-disabled");
	mkdirSync(disabledBuildDir, { recursive: true });
	writeFileSync(join(disabledBuildDir, "package.json"), '{"type":"module"}\n', "utf8");
	compileChangedSurface(disabledBuildDir);

	const homeDir = join(workDir, "home-disabled");
	writeInitialConfig(homeDir, '{"imageAttachments":false}');
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;

	const { BoxEditor } = await importShared("editor/box-editor.js", disabledBuildDir);
	const { resolveUserZoneStyle } = await importShared("user-zone/designs.js", disabledBuildDir);
	const { setFullTheme } = await importShared("theme/theme-extras.js", disabledBuildDir);
	const { loadConfig } = await importShared("config.js", disabledBuildDir);
	setFullTheme({ sourcePath: join(workDir, "theme.json") }, true);
	setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	assert(loadConfig().imageAttachments === false, "explicit false disables the feature");

	const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
	const editor = new BoxEditor(
		tui,
		makeTheme(),
		{ matches: () => false },
		makeTheme(),
		workDir,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		resolveUserZoneStyle("gemini"),
	);
	const pasted = makeHostClipboardImage(64);
	editor.setText("");
	editor.insertTextAtCursor(pasted);
	assert(editor.getText() === pasted, "disabled feature keeps host path-insert behavior");
	assert(existsSync(pasted), "disabled feature leaves the host tmp file alone");
	const lines = editor.render(88).map(stripAnsi);
	assert(!lines.some((line) => /\[Image #\d+\]/.test(stripAnsi(line))), "disabled feature renders no tokens");
	assert(editor.getImageAttachments().length === 0, "disabled feature resolves no tokens on submit");
	rmSync(pasted, { force: true });
	const disabledStore = join(homeDir, ".pi", "agent", "sessions");
	assert(!existsSync(disabledStore) || !existsSync(join(disabledStore, `--${workDir.replace(/^\/\\/, "").replace(/[/\\:]/g, "-")}--`, "images")), "disabled feature writes no image store");
	console.log("disabled feature smoke ok");
}

prepareWorkDir();
compileChangedSurface();
await runConfigSmoke("image-attachments-default", undefined, ({ config, raw }) => {
	assert(config.imageAttachments === true, "default config enables imageAttachments");
	assert(raw.imageAttachments === true, "scaffolded config backfills imageAttachments:true");
});
await runConfigSmoke("image-attachments-off", "{\"imageAttachments\":false}", ({ config, raw }) => {
	assert(config.imageAttachments === false, "explicit false normalizes");
	assert(raw.imageAttachments === false, "explicit false preserved on disk");
});
await runConfigSmoke("image-attachments-invalid", "{\"imageAttachments\":\"nope\"}", ({ config }) => {
	assert(config.imageAttachments === true, "invalid value falls back to default true");
});
await runAttachmentUnitSmoke();
await runImageSubmitSmoke();
await runBoxEditorIntegrationSmoke();
await runStartupStoreSmoke();
await runDisabledFeatureSmoke();
console.log("image attachments smoke ok");
