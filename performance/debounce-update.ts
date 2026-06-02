/**
 * Debounce AssistantMessageComponent.updateContent during streaming.
 *
 * Pi core emits `message_update` for every `*_delta` (text/thinking/toolcall),
 * and interactive-mode calls `streamingComponent.updateContent(message)` on
 * each one. updateContent() does `clear()` + `new Markdown(fullText)` => the
 * markdown lexer re-parses the entire growing text on every token => O(N²)
 * CPU during long streams.
 *
 * Strategy:
 * - When the message is mid-stream (`stopReason === undefined`), coalesce
 *   updates into a single setTimeout flush (~33ms ≈ 30 fps Crush-style presentation cadence).
 * - When the message is finalized (`stopReason` present: end/aborted/error),
 *   flush immediately. This keeps `message_end` correctness intact.
 * - Toggle paths (`invalidate`, `setHideThinkingBlock`, `setHiddenThinkingLabel`)
 *   re-call updateContent with `this.lastMessage`, which by then has a
 *   `stopReason` => flushed immediately => no UX regression.
 *
 * NOTE: Must be installed AFTER any other prototype patch that wraps
 * `updateContent` (e.g. assistant-prefix), so this debouncer becomes the
 * outermost wrapper and prevents the inner chain from running on every delta.
 */

import { profileCount, profileDuration, profileNow, profileSample } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.debounce-update-content.patched");

/** Coalesce window for streaming deltas (ms). */
const STREAM_FLUSH_MS = 33;

const TIMER_KEY = Symbol("debounce-timer");
const PENDING_KEY = Symbol("debounce-pending");
const LAST_PRESENTATION_AT_KEY = Symbol("debounce-last-presentation-at");
const LAST_PRESENTATION_CHARS_KEY = Symbol("debounce-last-presentation-chars");

function countAssistantMessageChars(message: any): number {
	const content = message?.content;
	if (Array.isArray(content)) {
		let chars = 0;
		for (const block of content) {
			if (typeof block?.text === "string") chars += block.text.length;
			if (typeof block?.thinking === "string") chars += block.thinking.length;
		}
		return chars;
	}
	return typeof message?.text === "string" ? message.text.length : 0;
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

export function installAssistantUpdateDebounce(AssistantMessageClass: any): void {
	const proto = AssistantMessageClass?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;

	const orig = proto.updateContent;
	if (typeof orig !== "function") return;

	proto.updateContent = function patchedUpdateContent(message: any) {
		profileCount("assistant.updateContent.calls");
		const stopReason = message?.stopReason;

		// Final/non-streaming message — flush immediately, cancel any pending.
		if (stopReason !== undefined && stopReason !== null) {
			profileCount("assistant.updateContent.final");
			const t = (this as any)[TIMER_KEY];
			if (t) {
				clearTimeout(t);
				(this as any)[TIMER_KEY] = null;
				profileCount("assistant.updateContent.cancelPending");
			}
			(this as any)[PENDING_KEY] = null;
			recordPresentationMetrics(this, message, "immediate");
			const start = profileNow();
			try {
				return orig.call(this, message);
			} finally {
				profileDuration("assistant.updateContent.ms", start);
			}
		}

		// Streaming — coalesce.
		profileCount("assistant.updateContent.streaming");
		(this as any)[PENDING_KEY] = message;
		if ((this as any)[TIMER_KEY]) {
			profileCount("assistant.updateContent.coalesced");
			return;
		}

		profileCount("assistant.updateContent.scheduled");
		(this as any)[TIMER_KEY] = setTimeout(() => {
			(this as any)[TIMER_KEY] = null;
			const pending = (this as any)[PENDING_KEY];
			(this as any)[PENDING_KEY] = null;
			if (!pending) return;
			profileCount("assistant.updateContent.flush");
			recordPresentationMetrics(this, pending, "flush");
			const start = profileNow();
			try {
				orig.call(this, pending);
			} finally {
				profileDuration("assistant.updateContent.ms", start);
			}
		}, STREAM_FLUSH_MS);
	};
}
