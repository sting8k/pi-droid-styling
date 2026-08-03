const PATCHED = Symbol.for("pi-droid-styling.resume-tool-refresh.patched");
const RUNTIME_STATE = Symbol.for("pi-droid-styling.resume-tool-refresh.runtime-state");
const PENDING_TIMER = Symbol.for("pi-droid-styling.resume-tool-refresh.pending-timer");
const VIRTUALIZED_CHAT_STATE = Symbol.for("pi-droid-styling.virtualized-chat.state");

type ToolComponentLike = {
	toolName?: unknown;
	toolDefinition?: unknown;
	updateDisplay?: () => void;
};

type InteractiveModeLike = {
	session?: {
		getToolDefinition?(name: string): unknown;
	};
	chatContainer?: {
		children?: unknown[];
		[VIRTUALIZED_CHAT_STATE]?: { hiddenChildren?: unknown[] };
	};
	ui?: { requestRender?(): void };
	[PENDING_TIMER]?: ReturnType<typeof setTimeout>;
};

type ResumeToolRefreshRuntime = {
	refresh(mode: InteractiveModeLike, expectedSession: unknown): void;
};

function collectChatChildren(mode: InteractiveModeLike): unknown[] {
	const chat = mode.chatContainer;
	if (!chat) return [];
	const hidden = chat[VIRTUALIZED_CHAT_STATE]?.hiddenChildren;
	const visible = Array.isArray(chat.children) ? chat.children : [];
	return [...(Array.isArray(hidden) ? hidden : []), ...visible];
}

function refreshRestoredTools(mode: InteractiveModeLike, expectedSession: unknown): void {
	if (!mode.session || mode.session !== expectedSession) return;
	const getDefinition = mode.session.getToolDefinition;
	if (typeof getDefinition !== "function") return;

	let refreshed = 0;
	const seen = new Set<unknown>();
	for (const candidate of collectChatChildren(mode)) {
		if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
		seen.add(candidate);
		const component = candidate as ToolComponentLike;
		if (typeof component.toolName !== "string" || typeof component.updateDisplay !== "function") continue;
		component.toolDefinition = getDefinition.call(mode.session, component.toolName);
		component.updateDisplay();
		refreshed++;
	}
	if (refreshed > 0) mode.ui?.requestRender?.();
}

/**
 * Pi restores historical tool components immediately after replacing a session.
 * Refresh them on the next turn of the event loop so renderer definitions and
 * session presentation state match the new runtime, without rebuilding chat or
 * duplicating editor history.
 */
export function installResumeToolRefresh(InteractiveModeClass: any): void {
	const proto = InteractiveModeClass?.prototype as any;
	if (!proto) return;

	proto[RUNTIME_STATE] = { refresh: refreshRestoredTools } satisfies ResumeToolRefreshRuntime;
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const baseRenderCurrentSessionState = proto.renderCurrentSessionState;
	if (typeof baseRenderCurrentSessionState !== "function") return;

	proto.renderCurrentSessionState = function patchedRenderCurrentSessionState(this: InteractiveModeLike, ...args: unknown[]) {
		const result = baseRenderCurrentSessionState.apply(this, args);
		const expectedSession = this.session;
		if (this[PENDING_TIMER]) clearTimeout(this[PENDING_TIMER]);
		this[PENDING_TIMER] = setTimeout(() => {
			this[PENDING_TIMER] = undefined;
			const runtime = proto[RUNTIME_STATE] as ResumeToolRefreshRuntime | undefined;
			runtime?.refresh(this, expectedSession);
		}, 0);
		return result;
	};
}
