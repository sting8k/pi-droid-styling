/**
 * Cache chat rendering for long sessions without changing the rendered buffer shape.
 *
 * Older chat children are rendered once per width and reused. Recent children stay
 * live so streaming assistant/tool updates continue to repaint normally.
 */

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

interface RenderCacheEntry {
	width: number;
	lines: string[];
}

/** Number of recent children to render live on every frame. */
const LIVE_TAIL = 30;

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

const ORIGINAL_ADD_CHILD = Symbol.for("pi-droid-styling.chat-render-cache.original-add-child");
const ORIGINAL_REMOVE_CHILD = Symbol.for("pi-droid-styling.chat-render-cache.original-remove-child");
const ORIGINAL_CLEAR = Symbol.for("pi-droid-styling.chat-render-cache.original-clear");
const ORIGINAL_INVALIDATE = Symbol.for("pi-droid-styling.chat-render-cache.original-invalidate");

function pushLines(target: string[], lines: string[]): void {
	for (let i = 0; i < lines.length; i++) target.push(lines[i]);
}

function patchChildInvalidation(component: AnyComponent, dropCache: (component: AnyComponent) => void): void {
	const target = component as any;
	const originalInvalidate = target[ORIGINAL_INVALIDATE] ?? component.invalidate;
	if (typeof originalInvalidate !== "function") return;
	target[ORIGINAL_INVALIDATE] = originalInvalidate;
	component.invalidate = function (this: AnyComponent): void {
		dropCache(this);
		originalInvalidate.call(this);
	};
}

export function virtualizeChatContainer(tui: AnyContainer): void {
	const chatContainer = findChatContainer(tui);
	if (!chatContainer) return;

	let renderCache = new WeakMap<AnyComponent, RenderCacheEntry>();
	const dropCache = (component: AnyComponent): void => {
		renderCache.delete(component);
	};

	const target = chatContainer as any;
	const originalAddChild = target[ORIGINAL_ADD_CHILD] ?? chatContainer.addChild;
	const originalRemoveChild = target[ORIGINAL_REMOVE_CHILD] ?? chatContainer.removeChild;
	const originalClear = target[ORIGINAL_CLEAR] ?? chatContainer.clear;
	target[ORIGINAL_ADD_CHILD] = originalAddChild;
	target[ORIGINAL_REMOVE_CHILD] = originalRemoveChild;
	target[ORIGINAL_CLEAR] = originalClear;

	chatContainer.addChild = function (this: AnyContainer, component: AnyComponent): void {
		dropCache(component);
		patchChildInvalidation(component, dropCache);
		return originalAddChild.call(this, component);
	};

	chatContainer.removeChild = function (this: AnyContainer, component: AnyComponent): void {
		dropCache(component);
		return originalRemoveChild.call(this, component);
	};

	chatContainer.clear = function (this: AnyContainer): void {
		renderCache = new WeakMap<AnyComponent, RenderCacheEntry>();
		return originalClear.call(this);
	};

	chatContainer.render = function (width: number): string[] {
		const children = chatContainer.children;
		const total = children.length;
		const liveStart = Math.max(0, total - LIVE_TAIL);
		const lines: string[] = [];

		for (let i = 0; i < total; i++) {
			const child = children[i];
			patchChildInvalidation(child, dropCache);

			if (i >= liveStart) {
				const rendered = child.render(width);
				renderCache.set(child, { width, lines: rendered });
				pushLines(lines, rendered);
				continue;
			}

			const cached = renderCache.get(child);
			if (cached?.width === width) {
				pushLines(lines, cached.lines);
				continue;
			}

			const rendered = child.render(width);
			renderCache.set(child, { width, lines: rendered });
			pushLines(lines, rendered);
		}

		return lines;
	};
}
