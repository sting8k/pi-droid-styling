/**
 * Virtualize chat rendering: freeze old children into a cached line array,
 * only re-render recent children each frame.
 *
 * Prevents UI lag in long sessions by avoiding O(N) component traversal
 * and O(N) line-array building every render cycle.
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

/** Number of recent children to keep "live" (re-rendered each frame) */
const ACTIVE_TAIL = 6;

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

const PATCHED = Symbol("virtualized");

export function virtualizeChatContainer(tui: AnyContainer): void {
	const chatContainer = findChatContainer(tui);
	if (!chatContainer || (chatContainer as any)[PATCHED]) return;
	(chatContainer as any)[PATCHED] = true;

	let frozenLines: string[] = [];
	let frozenCount = 0; // number of children whose output is in frozenLines
	let frozenWidth = -1;

	function resetFrozen() {
		frozenLines = [];
		frozenCount = 0;
		frozenWidth = -1;
	}

	// --- Wrap clear() ---
	const origClear = chatContainer.clear.bind(chatContainer);
	chatContainer.clear = function () {
		resetFrozen();
		origClear();
	};

	// --- Wrap removeChild() ---
	const origRemove = chatContainer.removeChild.bind(chatContainer);
	chatContainer.removeChild = function (c: AnyComponent) {
		const idx = chatContainer.children.indexOf(c);
		if (idx !== -1 && idx < frozenCount) {
			resetFrozen(); // frozen region affected, must rebuild
		}
		origRemove(c);
	};

	// --- Wrap invalidate() ---
	const origInvalidate = chatContainer.invalidate?.bind(chatContainer);
	chatContainer.invalidate = function () {
		resetFrozen();
		origInvalidate?.();
	};

	// --- Replace render() ---
	chatContainer.render = function (width: number): string[] {
		const children = chatContainer.children;
		const total = children.length;

		// Too few children — just render normally
		if (total <= ACTIVE_TAIL) {
			resetFrozen();
			const lines: string[] = [];
			for (let i = 0; i < total; i++) {
				const cl = children[i].render(width);
				for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
			}
			return lines;
		}

		const freezeTarget = total - ACTIVE_TAIL;

		// Width changed — invalidate frozen cache
		if (frozenWidth !== -1 && frozenWidth !== width) {
			resetFrozen();
		}

		// Freeze more children (only appends, never re-renders already-frozen)
		if (freezeTarget > frozenCount) {
			for (let i = frozenCount; i < freezeTarget; i++) {
				const cl = children[i].render(width);
				for (let j = 0; j < cl.length; j++) frozenLines.push(cl[j]);
			}
			frozenCount = freezeTarget;
			frozenWidth = width;
		}

		// Build output: frozen prefix + live tail
		const lines: string[] = new Array(frozenLines.length);
		for (let i = 0; i < frozenLines.length; i++) lines[i] = frozenLines[i];

		for (let i = frozenCount; i < total; i++) {
			const cl = children[i].render(width);
			for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
		}

		return lines;
	};
}
