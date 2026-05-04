/**
 * Virtualize chat rendering: only render the latest N children,
 * hide older ones with a compact indicator line.
 *
 * Prevents UI lag in long sessions by skipping old components entirely.
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

/** Number of recent children to render */
const VISIBLE_TAIL = 30;

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

const PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.patched");

export function virtualizeChatContainer(tui: AnyContainer): void {
	const chatContainer = findChatContainer(tui);
	if (!chatContainer || (chatContainer as any)[PATCHED]) return;
	(chatContainer as any)[PATCHED] = true;

	chatContainer.render = function (width: number): string[] {
		const children = chatContainer.children;
		const total = children.length;

		// Few enough children — render all
		if (total <= VISIBLE_TAIL) {
			const lines: string[] = [];
			for (let i = 0; i < total; i++) {
				const cl = children[i].render(width);
				for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
			}
			return lines;
		}

		// Build indicator
		const hidden = total - VISIBLE_TAIL;
		const indicator = `\x1b[2m  ··· ${hidden} older messages hidden ···\x1b[0m`;

		// Render only the tail
		const lines: string[] = [indicator, ""];
		for (let i = total - VISIBLE_TAIL; i < total; i++) {
			const cl = children[i].render(width);
			for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
		}

		return lines;
	};
}
