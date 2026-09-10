/**
 * Assistant streaming-state seam.
 *
 * `pi-ai` builds every streaming partial with `stopReason: "stop"` from the first delta
 * (`providers/anthropic.js` and every other provider), so `message.stopReason === undefined`
 * is never true during a real assistant stream — it cannot be used as a liveness signal.
 * The extension tracks the stream itself instead: `index.ts` marks the stream active on the
 * assistant `message_start`, refreshes it on `message_update`, and ends it on `message_end`,
 * `agent_end`, and `session_shutdown`. `agent-session` emits each event to extensions before
 * UI listeners, so the token is already correct when Pi core calls `updateContent`.
 *
 * `attachComponentToStream(component, message)` must run at the top of every `updateContent`
 * wrapper, before the base method is delegated to, with the message the wrapper received. A
 * component is tagged exactly once, on its first-ever call: it takes the active token iff a
 * stream is active and the message is the very object the extension is tracking (Pi passes the
 * `message_start`/`message_update` event message straight into the streaming component, while a
 * history component is built with its own historical message). Every other first call freezes
 * the NONE sentinel, and later calls never rewrite the tag — so a clone passed by the outer
 * presentation buffer still reads the tag made from the original message. Building the tag from
 * a token object rather than a counter means tags from a previous extension load can never
 * collide after a reload. Known, accepted: an extension reload mid-stream leaves the current
 * streaming component tagged with the previous load's token, so it renders settled until the
 * next message.
 */

const STREAM_TAG = Symbol.for("pi-droid-styling.assistant-stream");
const NONE = Symbol("pi-droid-styling.assistant-stream.none");

let activeToken: object | null = null;
let activeMessage: unknown = null;

export function beginAssistantStream(message?: unknown): void {
	activeToken = {};
	activeMessage = message ?? null;
}

/** Refresh the tracked message on `message_update`, beginning a stream if none is active. */
export function trackAssistantStreamMessage(message: unknown): void {
	if (activeToken === null) {
		beginAssistantStream(message);
		return;
	}
	activeMessage = message;
}

export function endAssistantStream(): void {
	activeToken = null;
	activeMessage = null;
}

/** Tag-once a component and report whether it is attached to the currently active stream. */
export function attachComponentToStream(component: any, message: unknown): boolean {
	if (!component || typeof component !== "object") return false;

	let tag = component[STREAM_TAG];
	if (tag === undefined) {
		tag = activeToken !== null && message === activeMessage ? activeToken : NONE;
		component[STREAM_TAG] = tag;
	}
	return activeToken !== null && tag === activeToken;
}

/** Read-only form of the same query; never tags the component. */
export function isComponentOnActiveStream(component: any): boolean {
	if (!component || typeof component !== "object") return false;
	const tag = component[STREAM_TAG];
	return activeToken !== null && tag !== undefined && tag === activeToken;
}
