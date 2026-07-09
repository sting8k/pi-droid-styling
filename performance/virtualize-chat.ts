/**
 * Virtualize chat rendering: only keep the latest N children active in the
 * chat container tree, park older ones in an overflow buffer, and show a
 * compact indicator line when history is hidden.
 *
 * Structural pruning is required for fixed-zone: its windowed root walk can
 * recurse into Container children and bypass a render-only cap.
 */

import { profileCount, profileSample } from "./profiler.js";

interface AnyComponent {
	render(width: number): string[];
	invalidate?(): void;
}

interface AnyContainer extends AnyComponent {
	children: AnyComponent[];
	addChild(component: AnyComponent): void;
	removeChild(component: AnyComponent): void;
	clear(): void;
}

type VirtualizedChatState = {
	visibleTail: number;
	/** Oldest → newest among children removed from the active tree. */
	hiddenChildren: AnyComponent[];
	methodsPatched: boolean;
	/**
	 * Set when patched clear/addChild/removeChild mutate the container.
	 * Used to distinguish API rebuilds (overflow is fresh) from wholesale
	 * `children = [...]` assignment (overflow from the previous tree is stale).
	 */
	apiMutated: boolean;
	originalAddChild: AnyContainer["addChild"];
	originalRemoveChild?: AnyContainer["removeChild"];
	originalClear: AnyContainer["clear"];
};

function normalizeVisibleTail(value: number): number {
	if (!Number.isFinite(value)) return 30;
	return Math.max(0, Math.floor(value));
}

export const VIRTUALIZED_CHAT_PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.patched");
export const VIRTUALIZED_CHAT_STATE = Symbol.for("pi-droid-styling.virtualized-chat.state");
/** Marks the TUI root → chat container relationship for fixed-zone lookups. */
export const VIRTUALIZED_CHAT_HOST = Symbol.for("pi-droid-styling.virtualized-chat.host-chat");

function isContainerLike(value: unknown): value is AnyContainer {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as AnyContainer;
	return Array.isArray(candidate.children)
		&& typeof candidate.addChild === "function"
		&& typeof candidate.clear === "function"
		&& typeof candidate.render === "function";
}

/**
 * Find the chatContainer in TUI's direct children.
 * Layout order: headerContainer(0), chatContainer(1), pending(2), status(3), ...
 */
function findChatContainer(tui: AnyContainer): AnyContainer | null {
	const children = Array.isArray(tui.children) ? tui.children : [];
	const hosted = (tui as any)[VIRTUALIZED_CHAT_HOST];
	if (isContainerLike(hosted)) return hosted;

	// Prefer an already-patched container (reload-safe / layout-shift safe).
	for (const child of children) {
		if (isContainerLike(child) && (child as any)[VIRTUALIZED_CHAT_PATCHED]) return child;
	}
	// Canonical index in InteractiveMode layout: header(0), chat(1), ...
	if (isContainerLike(children[1])) return children[1];

	// Fallback: largest container-like child (chat grows with history).
	let best: AnyContainer | null = null;
	let bestCount = -1;
	let containersSeen = 0;
	let second: AnyContainer | null = null;
	for (const child of children) {
		if (!isContainerLike(child)) continue;
		containersSeen += 1;
		if (containersSeen === 2) second = child;
		const count = Array.isArray(child.children) ? child.children.length : 0;
		if (count > bestCount) {
			best = child;
			bestCount = count;
		}
	}
	if (best && bestCount > 0) return best;
	return second;
}

function getState(value: unknown): VirtualizedChatState | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	return (value as any)[VIRTUALIZED_CHAT_STATE] as VirtualizedChatState | undefined;
}

export function getVirtualizedChatTail(value: unknown): number | undefined {
	if (!isPatchedVirtualizedChatContainer(value)) return undefined;
	const state = getState(value);
	if (!state || !Number.isFinite(state.visibleTail)) return undefined;
	return normalizeVisibleTail(state.visibleTail);
}

export function isPatchedVirtualizedChatContainer(value: unknown): boolean {
	return typeof value === "object" && value !== null && Boolean((value as any)[VIRTUALIZED_CHAT_PATCHED]);
}

/**
 * Move older children out of (or back into) the active children array so every
 * consumer — including fixed-zone window walks — only sees the visible tail.
 */
function syncHiddenChildren(chatContainer: AnyContainer, state: VirtualizedChatState): void {
	const tail = state.visibleTail;
	if (!Array.isArray(chatContainer.children)) return;

	if (tail === 0) {
		if (state.hiddenChildren.length === 0) return;
		chatContainer.children = state.hiddenChildren.concat(chatContainer.children);
		state.hiddenChildren = [];
		profileCount("chat.virtualize.restore.hidden");
		profileSample("chat.virtualize.children.count", chatContainer.children.length);
		return;
	}

	// Grow window (e.g. 2 → 5): pull newest parked items back into the active prefix.
	if (chatContainer.children.length < tail && state.hiddenChildren.length > 0) {
		const need = Math.min(tail - chatContainer.children.length, state.hiddenChildren.length);
		const restored = state.hiddenChildren.splice(state.hiddenChildren.length - need, need);
		chatContainer.children = restored.concat(chatContainer.children);
		profileCount("chat.virtualize.restore.partial");
		profileSample("chat.virtualize.hiddenChildren.count", state.hiddenChildren.length);
		profileSample("chat.virtualize.visibleTail.count", tail);
	}

	// Shrink window: park oldest active children (oldest → newest in hiddenChildren).
	if (chatContainer.children.length > tail) {
		const removeCount = chatContainer.children.length - tail;
		const removed = chatContainer.children.splice(0, removeCount);
		state.hiddenChildren.push(...removed);
		profileCount("chat.virtualize.prune");
		profileSample("chat.virtualize.hiddenChildren.count", state.hiddenChildren.length);
		profileSample("chat.virtualize.visibleTail.count", tail);
	}
}

function ensureMethodPatches(chatContainer: AnyContainer, state: VirtualizedChatState): void {
	if (state.methodsPatched) return;
	state.methodsPatched = true;
	state.originalAddChild = chatContainer.addChild.bind(chatContainer);
	state.originalClear = chatContainer.clear.bind(chatContainer);
	if (typeof chatContainer.removeChild === "function") {
		state.originalRemoveChild = chatContainer.removeChild.bind(chatContainer);
	}

	chatContainer.addChild = (component: AnyComponent) => {
		state.apiMutated = true;
		state.originalAddChild(component);
		syncHiddenChildren(chatContainer, state);
	};

	chatContainer.removeChild = (component: AnyComponent) => {
		state.apiMutated = true;
		const hiddenIndex = state.hiddenChildren.indexOf(component);
		if (hiddenIndex !== -1) {
			state.hiddenChildren.splice(hiddenIndex, 1);
			return;
		}
		if (state.originalRemoveChild) {
			state.originalRemoveChild(component);
			return;
		}
		const index = chatContainer.children.indexOf(component);
		if (index !== -1) chatContainer.children.splice(index, 1);
	};

	chatContainer.clear = () => {
		state.apiMutated = true;
		state.hiddenChildren = [];
		state.originalClear();
	};
}

/**
 * Apply virtualization to a known chat container instance.
 * Prefer this when InteractiveMode.chatContainer is available.
 */
export function virtualizeChatContainerInstance(
	chatContainer: AnyContainer,
	visibleTail = 30,
	tui?: AnyContainer | null,
): void {
	if (!isContainerLike(chatContainer)) return;

	const existing = getState(chatContainer);
	const state: VirtualizedChatState = existing ?? {
		visibleTail: 30,
		hiddenChildren: [],
		methodsPatched: false,
		apiMutated: false,
		originalAddChild: chatContainer.addChild.bind(chatContainer),
		originalClear: chatContainer.clear.bind(chatContainer),
	};
	state.visibleTail = normalizeVisibleTail(visibleTail);
	(chatContainer as any)[VIRTUALIZED_CHAT_STATE] = state;
	(chatContainer as any)[VIRTUALIZED_CHAT_PATCHED] = true;
	if (tui && typeof tui === "object") {
		(tui as any)[VIRTUALIZED_CHAT_HOST] = chatContainer;
	}

	ensureMethodPatches(chatContainer, state);
	syncHiddenChildren(chatContainer, state);

	chatContainer.render = function (width: number): string[] {
		// Re-sync in case callers mutated children without addChild (defensive).
		syncHiddenChildren(chatContainer, state);

		const children = chatContainer.children;
		const total = children.length;
		const hidden = state.hiddenChildren.length;
		const tail = state.visibleTail;

		profileSample("chat.virtualize.children.count", total);
		profileSample("chat.virtualize.hiddenChildren.count", hidden);
		profileSample("chat.virtualize.visibleTail.count", tail);

		if (tail === 0 || hidden === 0) {
			profileCount("chat.virtualize.render.full");
			const lines: string[] = [];
			for (let i = 0; i < total; i++) {
				const cl = children[i].render(width);
				for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
			}
			return lines;
		}

		profileCount("chat.virtualize.render.capped");
		const indicator = `\x1b[2m  ··· ${hidden} older messages hidden ···\x1b[0m`;
		const lines: string[] = [indicator, ""];
		for (let i = 0; i < total; i++) {
			const cl = children[i].render(width);
			for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
		}
		return lines;
	};
}

export function virtualizeChatContainer(tui: AnyContainer, visibleTail = 30): void {
	const chatContainer = findChatContainer(tui);
	if (!chatContainer) return;
	virtualizeChatContainerInstance(chatContainer, visibleTail, tui);
}

export function isVirtualizedChatContainer(value: unknown): boolean {
	const tail = getVirtualizedChatTail(value);
	return typeof tail === "number" && tail > 0;
}

const INTERACTIVE_CHAT_VIRTUALIZE_PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.interactive-hooks");
/** Live getter refreshed on every install so extension reloads do not freeze the first closure. */
const INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL = Symbol.for("pi-droid-styling.virtualized-chat.interactive-get-tail");

type InteractiveModeLike = {
	chatContainer?: AnyContainer;
	ui?: AnyContainer;
};

/**
 * Hook InteractiveMode methods that rebuild chat content so virtualization always
 * targets the real `this.chatContainer` (not a guessed TUI child index).
 *
 * Reload-safe: re-calling install updates the live getVisibleTail source without
 * stacking wrappers.
 */
export function installInteractiveChatVirtualization(
	InteractiveModeClass: any,
	getVisibleTail: () => number,
): void {
	const proto = InteractiveModeClass?.prototype as (Record<PropertyKey, unknown> & InteractiveModeLike) | undefined;
	if (!proto) return;

	// Always refresh — extension reload installs a new module closure.
	(proto as any)[INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL] = getVisibleTail;

	if ((proto as any)[INTERACTIVE_CHAT_VIRTUALIZE_PATCHED]) return;
	(proto as any)[INTERACTIVE_CHAT_VIRTUALIZE_PATCHED] = true;

	const applyFromMode = (mode: InteractiveModeLike) => {
		const chat = mode.chatContainer;
		if (!chat) return;
		// If the rebuild used patched clear/addChild, overflow is already correct.
		// If it assigned `children = [...]` wholesale, parked overflow is stale.
		const existing = getState(chat);
		if (existing) {
			if (!existing.apiMutated) existing.hiddenChildren = [];
			existing.apiMutated = false;
		}
		const getter = (proto as any)[INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL] as (() => number) | undefined;
		const raw = typeof getter === "function" ? getter() : 30;
		const tail = normalizeVisibleTail(raw);
		virtualizeChatContainerInstance(chat, tail, mode.ui ?? null);
		profileCount("chat.virtualize.interactiveHook.apply");
	};

	for (const methodName of ["renderInitialMessages", "renderCurrentSessionState"] as const) {
		const original = (proto as any)[methodName];
		if (typeof original !== "function") continue;
		(proto as any)[methodName] = function patchedInteractiveChatVirtualize(this: InteractiveModeLike, ...args: unknown[]) {
			// Scope apiMutated to this rebuild only so a prior live addChild cannot
			// mask a later wholesale `children = [...]` assignment.
			const prior = this.chatContainer ? getState(this.chatContainer) : undefined;
			if (prior) prior.apiMutated = false;
			const result = (original as (...inner: unknown[]) => unknown).apply(this, args);
			try {
				applyFromMode(this);
			} catch {
				profileCount("chat.virtualize.interactiveHook.error");
			}
			return result;
		};
	}
}
