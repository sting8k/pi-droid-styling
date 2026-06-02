/**
 * Smooth AssistantMessageComponent.updateContent during streaming.
 *
 * Pi core emits `message_update` for every `*_delta` (text/thinking/toolcall),
 * and interactive-mode calls `streamingComponent.updateContent(message)` on
 * each one. updateContent() does `clear()` + `new Markdown(fullText)`, so raw
 * token bursts can both over-render and appear chunky to the eye.
 *
 * Strategy:
 * - When the message is mid-stream (`stopReason === undefined`), keep the
 *   latest source message but reveal it through a 33ms presentation buffer.
 * - Small chunks catch up immediately; large chunks are drip-fed over several
 *   ticks so they do not appear as one giant visual jump.
 * - When the message is finalized (`stopReason` present: end/aborted/error),
 *   flush the full final message immediately. This keeps `message_end`
 *   correctness intact.
 * - Toggle paths (`invalidate`, `setHideThinkingBlock`, `setHiddenThinkingLabel`)
 *   re-call updateContent with `this.lastMessage`; while streaming that source
 *   re-enters the buffer, and after final it flushes immediately.
 *
 * NOTE: Must be installed AFTER any other prototype patch that wraps
 * `updateContent` (e.g. assistant-prefix), so this presentation buffer becomes
 * the outermost wrapper and prevents the inner chain from running on every delta.
 */

import { profileCount, profileDuration, profileNow, profileSample } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.debounce-update-content.patched");

/** Presentation tick, matching the Crush-style 33ms cadence. */
const STREAM_FLUSH_MS = 33;
const TARGET_CATCHUP_FRAMES = 8;
const MIN_REVEAL_CHARS = 12;
const MAX_REVEAL_CHARS = 120;

const TIMER_KEY = Symbol("presentation-timer");
const SOURCE_KEY = Symbol("presentation-source");
const DISPLAYED_LENGTHS_KEY = Symbol("presentation-displayed-lengths");
const LAST_SOURCE_TEXTS_KEY = Symbol("presentation-last-source-texts");
const LAST_PRESENTATION_AT_KEY = Symbol("presentation-last-at");
const LAST_PRESENTATION_CHARS_KEY = Symbol("presentation-last-chars");

let requestRender: (() => void) | undefined;
const Segmenter = (Intl as any).Segmenter;
const graphemeSegmenter = typeof Segmenter === "function"
	? new Segmenter(undefined, { granularity: "grapheme" })
	: undefined;

export function setAssistantUpdateRenderRequester(requester: (() => void) | undefined): void {
	requestRender = requester;
}

type TextEntry = {
	key: string;
	text: string;
};

function getGraphemes(text: string): string[] {
	if (graphemeSegmenter) {
		return Array.from(graphemeSegmenter.segment(text), (part: any) => String(part.segment));
	}
	return Array.from(text);
}

function countGraphemes(text: string): number {
	return getGraphemes(text).length;
}

function sliceGraphemes(text: string, length: number): string {
	if (length <= 0) return "";
	const graphemes = getGraphemes(text);
	if (length >= graphemes.length) return text;
	return graphemes.slice(0, length).join("");
}

function collectTextEntries(message: any): TextEntry[] {
	const content = message?.content;
	if (Array.isArray(content)) {
		const entries: TextEntry[] = [];
		for (let index = 0; index < content.length; index++) {
			const block = content[index];
			if (typeof block?.text === "string") entries.push({ key: `content:${index}:text`, text: block.text });
			if (typeof block?.thinking === "string") entries.push({ key: `content:${index}:thinking`, text: block.thinking });
		}
		return entries;
	}
	return typeof message?.text === "string" ? [{ key: "message:text", text: message.text }] : [];
}

function getDisplayedLengths(component: any): Map<string, number> {
	let lengths = component[DISPLAYED_LENGTHS_KEY] as Map<string, number> | undefined;
	if (!lengths) {
		lengths = new Map();
		component[DISPLAYED_LENGTHS_KEY] = lengths;
	}
	return lengths;
}

function clearPresentationState(component: any): void {
	const timer = component[TIMER_KEY];
	if (timer) {
		clearTimeout(timer);
		profileCount("assistant.updateContent.cancelPending");
	}
	component[TIMER_KEY] = null;
	component[SOURCE_KEY] = null;
	(component[DISPLAYED_LENGTHS_KEY] as Map<string, number> | undefined)?.clear();
	(component[LAST_SOURCE_TEXTS_KEY] as Map<string, string> | undefined)?.clear();
}

function updateSourceState(component: any, message: any): void {
	const entries = collectTextEntries(message);
	const current = new Map(entries.map((entry) => [entry.key, entry.text]));
	let previous = component[LAST_SOURCE_TEXTS_KEY] as Map<string, string> | undefined;
	const lengths = getDisplayedLengths(component);
	if (!previous) {
		previous = new Map();
		component[LAST_SOURCE_TEXTS_KEY] = previous;
	}

	for (const [key, text] of current) {
		const previousText = previous.get(key);
		if (previousText === undefined) {
			lengths.set(key, 0);
		} else if (!text.startsWith(previousText)) {
			lengths.set(key, 0);
			profileCount("assistant.updateContent.presentation.reset");
		}
	}

	for (const key of Array.from(lengths.keys())) {
		if (!current.has(key)) lengths.delete(key);
	}

	component[LAST_SOURCE_TEXTS_KEY] = current;
}

function countAssistantMessageChars(message: any): number {
	let chars = 0;
	for (const entry of collectTextEntries(message)) chars += countGraphemes(entry.text);
	return chars;
}

function countDisplayedChars(component: any): number {
	let chars = 0;
	const lengths = getDisplayedLengths(component);
	for (const entry of collectTextEntries(component[SOURCE_KEY])) {
		chars += Math.min(lengths.get(entry.key) ?? 0, countGraphemes(entry.text));
	}
	return chars;
}

function computeBacklog(component: any): number {
	return Math.max(0, countAssistantMessageChars(component[SOURCE_KEY]) - countDisplayedChars(component));
}

function computeRevealChars(backlog: number): number {
	if (backlog <= 0) return 0;
	const catchup = Math.ceil(backlog / TARGET_CATCHUP_FRAMES);
	return Math.min(backlog, Math.max(MIN_REVEAL_CHARS, Math.min(MAX_REVEAL_CHARS, catchup)));
}

function revealNextChunk(component: any, revealChars: number): number {
	let remaining = revealChars;
	let revealed = 0;
	const lengths = getDisplayedLengths(component);
	for (const entry of collectTextEntries(component[SOURCE_KEY])) {
		if (remaining <= 0) break;
		const sourceLength = countGraphemes(entry.text);
		const currentLength = Math.min(lengths.get(entry.key) ?? 0, sourceLength);
		const available = sourceLength - currentLength;
		if (available <= 0) continue;
		const take = Math.min(available, remaining);
		lengths.set(entry.key, currentLength + take);
		remaining -= take;
		revealed += take;
	}
	return revealed;
}

function cloneDisplayedMessage(message: any, displayedLengths: Map<string, number>): any {
	if (!message || typeof message !== "object") return message;
	const clone = { ...message };
	const content = message.content;
	if (Array.isArray(content)) {
		clone.content = content.map((block: any, index: number) => {
			if (!block || typeof block !== "object") return block;
			const blockClone = { ...block };
			const textKey = `content:${index}:text`;
			const thinkingKey = `content:${index}:thinking`;
			if (typeof block.text === "string") {
				blockClone.text = sliceGraphemes(block.text, displayedLengths.get(textKey) ?? 0);
			}
			if (typeof block.thinking === "string") {
				blockClone.thinking = sliceGraphemes(block.thinking, displayedLengths.get(thinkingKey) ?? 0);
			}
			return blockClone;
		});
	} else if (typeof message.text === "string") {
		clone.text = sliceGraphemes(message.text, displayedLengths.get("message:text") ?? 0);
	}
	return clone;
}

function recordPresentationMetrics(component: any, message: any, mode: "flush" | "immediate"): void {
	const now = profileNow();
	if (now <= 0) return;

	profileCount(`assistant.updateContent.presentation.${mode}`);

	const previousAt = component[LAST_PRESENTATION_AT_KEY];
	if (typeof previousAt === "number" && previousAt > 0) {
		profileSample("assistant.updateContent.presentation.interval.ms", now - previousAt);
	}
	component[LAST_PRESENTATION_AT_KEY] = now;

	const chars = countAssistantMessageChars(message);
	profileSample("assistant.updateContent.presentation.chars.count", chars);

	const previousChars = component[LAST_PRESENTATION_CHARS_KEY];
	if (typeof previousChars === "number") {
		if (chars >= previousChars) {
			profileSample("assistant.updateContent.presentation.deltaChars.count", chars - previousChars);
		} else {
			profileCount("assistant.updateContent.presentation.charResets");
			profileSample("assistant.updateContent.presentation.deltaChars.count", chars);
		}
	} else {
		profileSample("assistant.updateContent.presentation.deltaChars.count", chars);
	}
	component[LAST_PRESENTATION_CHARS_KEY] = chars;
}

function requestPresentationRender(): void {
	if (!requestRender) return;
	try {
		requestRender();
		profileCount("assistant.updateContent.presentation.requestRender");
	} catch {
		profileCount("assistant.updateContent.presentation.requestRenderError");
	}
}

export function installAssistantUpdateDebounce(AssistantMessageClass: any): void {
	const proto = AssistantMessageClass?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;

	const orig = proto.updateContent;
	if (typeof orig !== "function") return;

	function scheduleTick(component: any): void {
		if (component[TIMER_KEY]) return;
		profileCount("assistant.updateContent.scheduled");
		component[TIMER_KEY] = setTimeout(() => {
			component[TIMER_KEY] = null;
			const source = component[SOURCE_KEY];
			if (!source) return;

			const backlogBefore = computeBacklog(component);
			profileSample("assistant.updateContent.presentation.backlogChars.count", backlogBefore);
			if (backlogBefore <= 0) return;

			const revealed = revealNextChunk(component, computeRevealChars(backlogBefore));
			if (revealed <= 0) return;
			profileCount("assistant.updateContent.flush");
			profileCount("assistant.updateContent.presentation.tick");
			profileSample("assistant.updateContent.presentation.revealedChars.count", revealed);

			const displayed = cloneDisplayedMessage(source, getDisplayedLengths(component));
			recordPresentationMetrics(component, displayed, "flush");
			const start = profileNow();
			try {
				orig.call(component, displayed);
				if (component?.lastMessage === displayed) component.lastMessage = source;
				requestPresentationRender();
			} finally {
				profileDuration("assistant.updateContent.ms", start);
			}

			const backlogAfter = computeBacklog(component);
			profileSample("assistant.updateContent.presentation.backlogAfterChars.count", backlogAfter);
			if (backlogAfter > 0) {
				scheduleTick(component);
			} else {
				profileCount("assistant.updateContent.presentation.drainComplete");
			}
		}, STREAM_FLUSH_MS);
	}

	proto.updateContent = function patchedUpdateContent(message: any) {
		profileCount("assistant.updateContent.calls");
		const stopReason = message?.stopReason;

		// Final/non-streaming message — flush immediately, cancel any pending.
		if (stopReason !== undefined && stopReason !== null) {
			profileCount("assistant.updateContent.final");
			clearPresentationState(this);
			recordPresentationMetrics(this, message, "immediate");
			const start = profileNow();
			try {
				return orig.call(this, message);
			} finally {
				profileDuration("assistant.updateContent.ms", start);
			}
		}

		// Streaming — keep the latest source and reveal it on presentation ticks.
		profileCount("assistant.updateContent.streaming");
		if ((this as any)[TIMER_KEY]) profileCount("assistant.updateContent.coalesced");
		(this as any)[SOURCE_KEY] = message;
		updateSourceState(this, message);
		scheduleTick(this);
	};
}
