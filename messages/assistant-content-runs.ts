/**
 * Shared model of the rendered content runs Pi core builds for an assistant message.
 *
 * Pi core changed this layout inside our supported peer range: up to 0.78 every visible
 * thinking block became its own child, while 0.84+ collapses each run of consecutive
 * thinking blocks into a single child. Every child lookup/patch must therefore address
 * rendered runs, not raw content blocks.
 */

export type AssistantContentRunKind = "text" | "thinking";

export interface AssistantContentRun {
	kind: AssistantContentRunKind;
	/** first content-block index feeding this run, used for stable per-run keys */
	blockIndex: number;
	/** text Pi core hands to the rendered child */
	text: string;
	/** position of this run's child inside contentContainer.children */
	childIndex: number;
	/** last content-block index feeding this run, used to detect blocks that follow it */
	endBlockIndex: number;
}

/** Two consecutive thinking blocks are the shortest message whose layout differs per core. */
const LAYOUT_PROBE_CONTENT = [
	{ type: "thinking", thinking: "a" },
	{ type: "thinking", thinking: "b" },
];

const layoutByComponentClass = new WeakMap<Function, boolean>();

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

export function hasVisibleAssistantContent(contentBlocks: any[]): boolean {
	return contentBlocks.some((contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock));
}

function buildRuns(contentBlocks: any[], groupThinkingRuns: boolean): AssistantContentRun[] {
	const runs: AssistantContentRun[] = [];

	for (let i = 0; i < contentBlocks.length; i++) {
		const contentBlock = contentBlocks[i];
		if (isVisibleTextBlock(contentBlock)) {
			runs.push({ kind: "text", blockIndex: i, endBlockIndex: i, text: contentBlock.text.trim(), childIndex: 0 });
			continue;
		}
		if (contentBlock?.type !== "thinking") continue;

		const blockIndex = i;
		const thinking: string[] = [];
		let endBlockIndex = blockIndex;
		if (groupThinkingRuns) {
			// Pi 0.84+ consumes every consecutive thinking block, blank ones included, into one run
			for (; i < contentBlocks.length && contentBlocks[i]?.type === "thinking"; i++) {
				if (isVisibleThinkingBlock(contentBlocks[i])) thinking.push(contentBlocks[i].thinking.trim());
			}
			i--;
			endBlockIndex = i;
		} else if (isVisibleThinkingBlock(contentBlock)) {
			thinking.push(contentBlock.thinking.trim());
		}
		if (thinking.length > 0) runs.push({ kind: "thinking", blockIndex, endBlockIndex, text: thinking.join("\n\n"), childIndex: 0 });
	}

	let childIndex = runs.length > 0 ? 1 : 0; // leading Spacer(1)
	for (let i = 0; i < runs.length; i++) {
		runs[i].childIndex = childIndex;
		childIndex += 1;
		if (runs[i].kind === "thinking" && i < runs.length - 1) childIndex += 1; // Spacer(1) after a thinking run
	}

	return runs;
}

function countRunChildren(runs: AssistantContentRun[]): number {
	// the last run never gets a trailing Spacer, so it closes the content children
	return runs.length === 0 ? 0 : runs[runs.length - 1].childIndex + 1;
}

/**
 * Asks the host component class how it lays out one probe message instead of inferring the
 * layout from live traffic, so the answer never depends on message history, order or stop
 * reason. Answers are cached per component class; Pi 0.84+ is assumed when probing fails.
 */
function groupsThinkingRuns(component: any): boolean {
	const componentClass = component?.constructor;
	if (typeof componentClass !== "function") return true;

	const cached = layoutByComponentClass.get(componentClass);
	if (cached !== undefined) return cached;

	// Cache the Pi 0.84+ assumption before probing: building the probe re-enters this module
	// through our own patched updateContent, and that re-entry must read an answer instead of
	// starting another probe. This also keeps the assumption when the host cannot be probed.
	layoutByComponentClass.set(componentClass, true);
	try {
		const probe = new componentClass({ role: "assistant", content: LAYOUT_PROBE_CONTENT });
		const children = probe?.contentContainer?.children;
		if (Array.isArray(children) && children.length === countRunChildren(buildRuns(LAYOUT_PROBE_CONTENT, false))) {
			layoutByComponentClass.set(componentClass, false);
		}
	} catch {
		// an unprobeable host keeps the cached assumption
	}

	return layoutByComponentClass.get(componentClass) as boolean;
}

/** Rendered runs for `message`, aligned with the child layout the host Pi core builds. */
export function getAssistantContentRuns(component: any, message: any): AssistantContentRun[] {
	const contentBlocks = Array.isArray(message?.content) ? (message.content as any[]) : [];
	return buildRuns(contentBlocks, groupsThinkingRuns(component));
}
