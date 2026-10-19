/**
 * Shared model of the rendered content runs Pi core builds for an assistant message.
 *
 * Pi core collapses each run of consecutive thinking blocks into a single child, so every
 * child lookup/patch must address rendered runs, not raw content blocks.
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

function buildRuns(contentBlocks: any[]): AssistantContentRun[] {
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
		// Pi consumes every consecutive thinking block, blank ones included, into one run
		for (; i < contentBlocks.length && contentBlocks[i]?.type === "thinking"; i++) {
			if (isVisibleThinkingBlock(contentBlocks[i])) thinking.push(contentBlocks[i].thinking.trim());
		}
		i--;
		const endBlockIndex = i;
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

/** Rendered runs for `message`, aligned with the child layout the host Pi core builds. */
export function getAssistantContentRuns(message: any): AssistantContentRun[] {
	const contentBlocks = Array.isArray(message?.content) ? (message.content as any[]) : [];
	return buildRuns(contentBlocks);
}
