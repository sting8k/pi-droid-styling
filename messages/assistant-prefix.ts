import { AssistantMessageComponent } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { dropLeadingColumns, fgHex, startsWithVisibleSpace, stripAnsi } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

let activeTheme: any = null;
let isPatched = false;

function buildPrefixSegment(): string {
	const prefix = getThemeExtra(activeTheme, "assistantPrefix");
	const color = getThemeExtra(activeTheme, "assistantPrefixColor");
	return activeTheme ? fgHex(activeTheme, color, prefix) : prefix;
}

function buildDividerLine(width: number): string {
	if (width <= 0) return "";
	const char = getThemeExtra(activeTheme, "dividerChar");
	const color = getThemeExtra(activeTheme, "dividerColor");
	const line = char.repeat(width);
	return activeTheme ? fgHex(activeTheme, color, line) : line;
}

function composePrefixedLine(line: string): string {
	const prefix = buildPrefixSegment();
	if (!line) return `${prefix}  `;
	return startsWithVisibleSpace(line) ? `${prefix} ${line}` : `${prefix}  ${line}`;
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

function hasVisibleAssistantContent(contentBlocks: any[]): boolean {
	return contentBlocks.some((contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock));
}

function isToolCallOnlyAssistantMessage(message: any): boolean {
	if (!message || !Array.isArray(message.content)) return false;
	const contentBlocks = message.content as any[];
	if (hasVisibleAssistantContent(contentBlocks)) return false;
	return contentBlocks.some((contentBlock) => contentBlock?.type === "toolCall");
}

function prefixFirstNonEmptyLine(lines: string[], width: number): string[] {
	if (width <= 0 || lines.length === 0) return lines;

	const compactPrefixBase = composePrefixedLine("");
	const compactPrefix =
		visibleWidth(compactPrefixBase) > width ? truncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
	const output = [...lines];

	let targetIndex = -1;
	for (let i = 0; i < output.length; i++) {
		const clean = stripAnsi(output[i] ?? "");
		if (clean.trim().length > 0) {
			targetIndex = i;
			break;
		}
	}

	if (targetIndex === -1) return [compactPrefix];

	const remainder = dropLeadingColumns(output[targetIndex] ?? "", 1); // drop 1-column left padding from Markdown/Text
	output[targetIndex] = composePrefixedLine(remainder);

	return output.map((renderedLine) =>
		visibleWidth(renderedLine) > width ? truncateToWidth(renderedLine, width, "") : renderedLine,
	);
}

export function installAssistantMessagePrefix(theme: any): void {
	activeTheme = theme;
	if (isPatched) return;
	isPatched = true;

	const baseUpdateContent = (AssistantMessageComponent.prototype as any).updateContent;
	if (typeof baseUpdateContent === "function") {
		(AssistantMessageComponent.prototype as any).updateContent = function patchedAssistantUpdateContent(message: any): void {
			baseUpdateContent.call(this, message);

			if (!message || !Array.isArray(message.content)) return;

			const contentBlocks = message.content as Array<any>;
			const firstTextIndex = contentBlocks.findIndex((contentBlock) => isVisibleTextBlock(contentBlock));
			if (firstTextIndex === -1) return;

			const hasThinkingBeforeText = contentBlocks
				.slice(0, firstTextIndex)
				.some((contentBlock) => isVisibleThinkingBlock(contentBlock));
			if (!hasThinkingBeforeText) return;

			const hasVisibleContent = contentBlocks.some(
				(contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock),
			);
			let childIndex = hasVisibleContent ? 1 : 0; // leading Spacer(1)
			let targetChild: any = undefined;

			for (let i = 0; i < contentBlocks.length; i++) {
				const contentBlock = contentBlocks[i];
				if (isVisibleTextBlock(contentBlock)) {
					if (i === firstTextIndex) {
						targetChild = this?.contentContainer?.children?.[childIndex];
						break;
					}
					childIndex += 1;
				} else if (isVisibleThinkingBlock(contentBlock)) {
					childIndex += 1; // thinking component
					const hasVisibleContentAfter = contentBlocks
						.slice(i + 1)
						.some((nextBlock) => isVisibleTextBlock(nextBlock) || isVisibleThinkingBlock(nextBlock));
					if (hasVisibleContentAfter) childIndex += 1; // inter-block Spacer(1)
				}
			}

			if (!targetChild || typeof targetChild.render !== "function") return;

			const childState = targetChild as any;
			if (childState.__assistantResponsePrefixPatched) return;
			childState.__assistantResponsePrefixPatched = true;

			const baseChildRender = targetChild.render.bind(targetChild);
			targetChild.render = (width: number): string[] => {
				const lines = baseChildRender(width);
				return prefixFirstNonEmptyLine(lines, width);
			};
		};
	}

	const baseRender = AssistantMessageComponent.prototype.render;

	AssistantMessageComponent.prototype.render = function patchedAssistantMessageRender(width: number): string[] {
		const lines = baseRender.call(this, width);
		if (width <= 0) return lines;

		const compactPrefixBase = composePrefixedLine("");
		const compactPrefix =
			visibleWidth(compactPrefixBase) > width ? truncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
		const divider = buildDividerLine(width);

		if (lines.length === 0) {
			return lines;
		}

		const output = [...lines];
		const startIndex = lines.length > 1 ? 1 : 0; // preserve leading spacer line

		let targetIndex = -1;
		for (let i = startIndex; i < output.length; i++) {
			const clean = stripAnsi(output[i] ?? "");
			if (clean.trim().length > 0) {
				targetIndex = i;
				break;
			}
		}

		if (targetIndex === -1) {
			return lines;
		}

		const line = output[targetIndex] ?? "";
		const remainder = dropLeadingColumns(line, 1); // drop the 1-column padding, keep content
		output[targetIndex] = composePrefixedLine(remainder);

		const result = output.map((renderedLine) =>
			visibleWidth(renderedLine) > width ? truncateToWidth(renderedLine, width, "") : renderedLine,
		);

		// Add turn divider before assistant message
		return [divider, ...result, ""];
	};
}
