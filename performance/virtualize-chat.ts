/**
 * Virtualize chat rendering: only render the latest N children,
 * hide older ones with a compact indicator line.
 *
 * Prevents UI lag in long sessions by skipping old components entirely.
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
};

function normalizeVisibleTail(value: number): number {
	if (!Number.isFinite(value)) return 30;
	return Math.max(0, Math.floor(value));
}

/**
 * Find the chatContainer in TUI's direct children.
 * Layout order: headerContainer(0), chatContainer(1), pending(2), status(3), ...
 */
function findChatContainer(tui: AnyContainer): AnyContainer | null {
	const candidate = tui.children[1];
	if (candidate && "children" in candidate && "addChild" in candidate && "clear" in candidate) {
		return candidate as AnyContainer;
	}
	return null;
}

export const VIRTUALIZED_CHAT_PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.patched");
const VIRTUALIZED_CHAT_STATE = Symbol.for("pi-droid-styling.virtualized-chat.state");

export function virtualizeChatContainer(tui: AnyContainer, visibleTail = 30): void {
	const chatContainer = findChatContainer(tui);
	if (!chatContainer) return;
	const state: VirtualizedChatState = (chatContainer as any)[VIRTUALIZED_CHAT_STATE] ?? { visibleTail: 30 };
	state.visibleTail = normalizeVisibleTail(visibleTail);
	(chatContainer as any)[VIRTUALIZED_CHAT_STATE] = state;
	(chatContainer as any)[VIRTUALIZED_CHAT_PATCHED] = true;

	chatContainer.render = function (width: number): string[] {
		const children = chatContainer.children;
		const total = children.length;

		const tail = state.visibleTail;

		// Disabled or few enough children — render all
		if (tail === 0 || total <= tail) {
			profileCount("chat.virtualize.render.full");
			profileSample("chat.virtualize.children.count", total);
			const lines: string[] = [];
			for (let i = 0; i < total; i++) {
				const cl = children[i].render(width);
				for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
			}
			return lines;
		}

		// Build indicator
		const hidden = total - tail;
		profileCount("chat.virtualize.render.capped");
		profileSample("chat.virtualize.children.count", total);
		profileSample("chat.virtualize.hiddenChildren.count", hidden);
		profileSample("chat.virtualize.visibleTail.count", tail);
		const indicator = `\x1b[2m  ··· ${hidden} older messages hidden ···\x1b[0m`;

		// Render only the tail
		const lines: string[] = [indicator, ""];
		for (let i = total - tail; i < total; i++) {
			const cl = children[i].render(width);
			for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
		}

		return lines;
	};
}

export function isVirtualizedChatContainer(value: unknown): boolean {
	if (typeof value !== "object" || value === null || !(value as any)[VIRTUALIZED_CHAT_PATCHED]) return false;
	const state = (value as any)[VIRTUALIZED_CHAT_STATE] as VirtualizedChatState | undefined;
	return Boolean(state && state.visibleTail > 0);
}
