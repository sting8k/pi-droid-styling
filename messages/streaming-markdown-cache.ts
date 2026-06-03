import { Markdown } from "@earendil-works/pi-tui";

import { profileCount, profileDuration, profileNow, profileSample } from "../performance/profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.streaming-markdown-cache.patched");
const STATE_KEY = Symbol("streaming-markdown-cache-state");
const WRAPPED_KEY = Symbol("streaming-markdown-cache-wrapped");

interface StableMarkdownState {
	stablePrefix: string;
	stableLines: string[];
	stableWidth?: number;
	configFingerprint?: string;
	lastText?: string;
}

interface MarkdownConfig {
	text: string;
	paddingX: number;
	paddingY: number;
	theme: any;
	defaultTextStyle?: any;
	options?: any;
}

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function getObjectId(value: any): string {
	if (!value || typeof value !== "object") return String(value);
	let id = objectIds.get(value);
	if (!id) {
		id = nextObjectId++;
		objectIds.set(value, id);
	}
	return String(id);
}

function stableJson(value: any): string {
	const seen = new WeakSet<object>();
	const normalize = (input: any): any => {
		if (!input || typeof input !== "object") return input;
		if (seen.has(input)) return "<circular>";
		seen.add(input);
		if (Array.isArray(input)) return input.map(normalize);
		return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
	};
	try {
		return JSON.stringify(normalize(value ?? null));
	} catch {
		return "<unserializable>";
	}
}

function getDefaultStyleFingerprint(style: any): string {
	if (!style) return "none";
	return stableJson({
		bold: Boolean(style.bold),
		italic: Boolean(style.italic),
		strikethrough: Boolean(style.strikethrough),
		underline: Boolean(style.underline),
		color: typeof style.color === "function",
		bgColor: typeof style.bgColor === "function",
	});
}

function getConfigFingerprint(config: MarkdownConfig): string {
	return [
		`px:${config.paddingX}`,
		`py:${config.paddingY}`,
		`theme:${getObjectId(config.theme)}`,
		`style:${getDefaultStyleFingerprint(config.defaultTextStyle)}`,
		`options:${stableJson(config.options)}`,
	].join("|");
}

function isVisibleTextBlock(contentBlock: any): boolean {
	return (
		contentBlock?.type === "text" &&
		typeof contentBlock.text === "string" &&
		contentBlock.text.trim().length > 0
	);
}

function isVisibleThinkingBlock(contentBlock: any): boolean {
	return (
		contentBlock?.type === "thinking" &&
		typeof contentBlock.thinking === "string" &&
		contentBlock.thinking.trim().length > 0
	);
}

function hasVisibleAssistantContent(contentBlocks: any[]): boolean {
	return contentBlocks.some((contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock));
}

function isMarkdownChild(child: any): boolean {
	return child instanceof Markdown || (
		child &&
		typeof child.render === "function" &&
		typeof child.text === "string" &&
		typeof child.paddingX === "number" &&
		typeof child.paddingY === "number" &&
		child.theme
	);
}

function getMarkdownConfig(child: any, text: string): MarkdownConfig {
	return {
		text,
		paddingX: typeof child.paddingX === "number" ? child.paddingX : 1,
		paddingY: typeof child.paddingY === "number" ? child.paddingY : 0,
		theme: child.theme,
		defaultTextStyle: child.defaultTextStyle,
		options: child.options,
	};
}

function renderMarkdown(config: MarkdownConfig, text: string, width: number): string[] {
	return new Markdown(
		text,
		config.paddingX,
		config.paddingY,
		config.theme,
		config.defaultTextStyle,
		config.options,
	).render(width);
}

function hasOpenFence(text: string): boolean {
	let fence: string | undefined;
	for (const line of text.split("\n")) {
		const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (!match) continue;
		const marker = match[1];
		const markerChar = marker[0];
		if (!fence) {
			fence = marker;
		} else if (markerChar === fence[0] && marker.length >= fence.length) {
			fence = undefined;
		}
	}
	return Boolean(fence);
}

function getLastMarkdownBlock(prefix: string): string {
	const blocks = prefix.trimEnd().split(/\n{2,}/);
	return blocks.at(-1) ?? "";
}

function isAmbiguousStableBlock(block: string): boolean {
	const lines = block.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) return true;
	if (lines.some((line) => /^ {4,}\S/.test(line))) return true;
	if (lines.some((line) => /^ {0,3}>/.test(line))) return true;
	if (lines.some((line) => /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line))) return true;
	if (lines.some((line) => /^ {0,3}\[[^\]]+\]:/.test(line))) return true;
	if (lines.some((line) => /^ {0,3}<[A-Za-z][^>]*>?\s*$/.test(line))) return true;
	if (lines.some((line) => /\|/.test(line)) && lines.some((line) => /^ {0,3}\|?\s*:?-{3,}:?/.test(line))) return true;
	if (lines.some((line) => /^ {0,3}(?:=+|-+)\s*$/.test(line))) return true;
	return false;
}

function isSafeStablePrefix(prefix: string): boolean {
	if (prefix.trim().length === 0) return false;
	if (hasOpenFence(prefix)) return false;
	return !isAmbiguousStableBlock(getLastMarkdownBlock(prefix));
}

export function findStableMarkdownBoundary(text: string): number {
	let boundary = -1;
	let searchFrom = 0;
	while (true) {
		const index = text.indexOf("\n\n", searchFrom);
		if (index === -1) break;
		const candidate = index + 2;
		const prefix = text.slice(0, candidate);
		if (isSafeStablePrefix(prefix)) boundary = candidate;
		searchFrom = candidate;
	}
	return boundary;
}

function resetStableState(state: StableMarkdownState, reason: string): void {
	state.stablePrefix = "";
	state.stableLines = [];
	state.stableWidth = undefined;
	profileCount("assistant.markdownStable.reset");
	profileCount(`assistant.markdownStable.reset.${reason}`);
}

class StableStreamingMarkdown {
	private readonly state: StableMarkdownState;
	private readonly blockKey: string;
	private readonly config: MarkdownConfig;

	constructor(state: StableMarkdownState, blockKey: string, config: MarkdownConfig) {
		this.state = state;
		this.blockKey = blockKey;
		this.config = config;
		(this as any)[WRAPPED_KEY] = true;
	}

	invalidate(): void {
		resetStableState(this.state, "invalidate");
	}

	render(width: number): string[] {
		const start = profileNow();
		try {
			return this.renderCached(width);
		} finally {
			profileDuration("assistant.markdownStable.render.ms", start);
		}
	}

	private renderCached(width: number): string[] {
		profileCount("assistant.markdownStable.render");
		profileCount(`assistant.markdownStable.render.${this.blockKey}`);
		const text = this.config.text;
		const state = this.state;
		const configFingerprint = getConfigFingerprint(this.config);
		if (state.configFingerprint !== undefined && state.configFingerprint !== configFingerprint) {
			resetStableState(state, "config");
		}
		state.configFingerprint = configFingerprint;

		if (state.stableWidth !== undefined && state.stableWidth !== width) {
			resetStableState(state, "width");
		}
		state.stableWidth = width;

		if (state.stablePrefix && !text.startsWith(state.stablePrefix)) {
			resetStableState(state, "nonPrefix");
		}

		const boundary = findStableMarkdownBoundary(text);
		if (boundary > state.stablePrefix.length) {
			const previousLength = state.stablePrefix.length;
			const stablePrefix = text.slice(0, boundary);
			const stableChunk = text.slice(previousLength, boundary);
			const promoteStart = profileNow();
			const chunkLines = renderMarkdown(this.config, stableChunk, width);
			profileDuration("assistant.markdownStable.promote.ms", promoteStart);
			state.stableLines = previousLength > 0 ? [...state.stableLines, ...chunkLines] : chunkLines;
			state.stablePrefix = stablePrefix;
			profileCount("assistant.markdownStable.promote");
			profileSample("assistant.markdownStable.stableChars.count", stablePrefix.length);
			profileSample("assistant.markdownStable.promotedChars.count", stableChunk.length);
		}

		if (!state.stablePrefix) {
			profileCount("assistant.markdownStable.fullFallback");
			state.lastText = text;
			return renderMarkdown(this.config, text, width);
		}

		profileCount("assistant.markdownStable.hit");
		const tail = text.slice(state.stablePrefix.length);
		profileSample("assistant.markdownStable.tailChars.count", tail.length);
		state.lastText = text;
		if (tail.trim().length === 0) return state.stableLines;
		return [...state.stableLines, ...renderMarkdown(this.config, tail, width)];
	}
}

function getStableStates(component: any): Map<string, StableMarkdownState> {
	let states = component[STATE_KEY] as Map<string, StableMarkdownState> | undefined;
	if (!states) {
		states = new Map();
		component[STATE_KEY] = states;
	}
	return states;
}

function getState(states: Map<string, StableMarkdownState>, blockKey: string): StableMarkdownState {
	let state = states.get(blockKey);
	if (!state) {
		state = { stablePrefix: "", stableLines: [] };
		states.set(blockKey, state);
	}
	return state;
}

function replaceMarkdownChild(component: any, childIndex: number, blockKey: string, text: string, seen: Set<string>): void {
	const children = component?.contentContainer?.children;
	const child = children?.[childIndex];
	if (!Array.isArray(children) || !isMarkdownChild(child)) return;

	seen.add(blockKey);
	const states = getStableStates(component);
	const state = getState(states, blockKey);
	children[childIndex] = new StableStreamingMarkdown(state, blockKey, getMarkdownConfig(child, text));
	profileCount("assistant.markdownStable.replaced");
}

function replaceStreamingMarkdownChildren(component: any, message: any): void {
	if (!message || !Array.isArray(message.content)) return;
	const contentBlocks = message.content as any[];
	const states = getStableStates(component);
	const seen = new Set<string>();
	const hasVisibleContent = hasVisibleAssistantContent(contentBlocks);
	let childIndex = hasVisibleContent ? 1 : 0;

	for (let i = 0; i < contentBlocks.length; i++) {
		const contentBlock = contentBlocks[i];
		if (isVisibleTextBlock(contentBlock)) {
			replaceMarkdownChild(component, childIndex, `${i}:text`, contentBlock.text.trim(), seen);
			childIndex += 1;
		} else if (isVisibleThinkingBlock(contentBlock)) {
			if (!component?.hideThinkingBlock) {
				replaceMarkdownChild(component, childIndex, `${i}:thinking`, contentBlock.thinking.trim(), seen);
			}
			childIndex += 1;
			const hasVisibleContentAfter = contentBlocks
				.slice(i + 1)
				.some((nextBlock) => isVisibleTextBlock(nextBlock) || isVisibleThinkingBlock(nextBlock));
			if (hasVisibleContentAfter) childIndex += 1;
		}
	}

	for (const key of states.keys()) {
		if (!seen.has(key)) states.delete(key);
	}
}

export function installAssistantStreamingMarkdownCache(AssistantMessageClass: any): void {
	const proto = AssistantMessageClass?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;

	const baseUpdateContent = proto.updateContent;
	if (typeof baseUpdateContent !== "function") return;

	proto.updateContent = function patchedAssistantStreamingMarkdownCache(message: any): void {
		baseUpdateContent.call(this, message);
		if (message?.stopReason !== undefined && message?.stopReason !== null) {
			const states = this[STATE_KEY] as Map<string, StableMarkdownState> | undefined;
			states?.clear();
			profileCount("assistant.markdownStable.finalBypass");
			return;
		}
		replaceStreamingMarkdownChildren(this, message);
	};
}
