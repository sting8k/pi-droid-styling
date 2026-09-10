import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../config.js";
import { getPresentationDesign } from "../presentation/state.js";
import { dropLeadingColumns, fgHex, startsWithVisibleSpace, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";
import { safeTakeTailToWidth, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { attachComponentToStream } from "./assistant-streaming-state.js";
import {
	type AssistantContentRun,
	getAssistantContentRuns,
	hasVisibleAssistantContent,
} from "./assistant-content-runs.js";

let activeTheme: any = null;
const PATCHED = Symbol.for("pi-droid-styling.assistant-prefix.patched");

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
	const design = getPresentationDesign();
	if (design.compactLayout) {
		if (!line) return `${prefix}${design.markerGap}`;
		return startsWithVisibleSpace(line) ? `${prefix}${line}` : `${prefix}${design.markerGap}${line}`;
	}
	if (!line) return `${prefix}  `;
	return startsWithVisibleSpace(line) ? `${prefix} ${line}` : `${prefix}  ${line}`;
}

function compactReasonixLines(lines: string[]): string[] {
	let first = 0;
	while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
	let last = lines.length - 1;
	while (last >= first && stripAnsi(lines[last] ?? "").trim() === "") last--;
	return first <= last ? [...lines.slice(first, last + 1), ""] : [];
}

function stripItalicAnsi(text: string): string {
	return text.replace(/\x1b\[3m/g, "").replace(/\x1b\[23m/g, "");
}

function styleThinkingLine(text: string): string {
	if (!getPresentationDesign().compactLayout) return stripItalicAnsi(text);
	const plain = stripAnsi(text);
	if (plain.trim().length === 0 || typeof activeTheme?.fg !== "function") return plain;
	const colored = activeTheme.fg("thinkingText", plain);
	return typeof activeTheme.italic === "function" ? activeTheme.italic(colored) : colored;
}

function getAssistantBodyWidth(width: number): number {
	return Math.max(1, width - safeVisibleWidth(composePrefixedLine("")) - 1);
}

function addAssistantGutter(lines: string[]): string[] {
	const indent = " ".repeat(safeVisibleWidth(composePrefixedLine("")));
	return lines.map((line) => {
		if (stripAnsi(line).trim().length === 0) return line;
		return `${indent}${dropLeadingColumns(line, 1)}`;
	});
}

const COLLAPSED_TAIL_MIN_BUDGET = 16;
const THINKING_TAIL_LIVE_MARKER = "▸";
const THINKING_TAIL_SETTLED_MARKER = "·";
const THINKING_BLOCK_MARKER_PATTERN = /^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/;

/** Last non-empty line of a thinking run, cleaned of a leading Markdown block marker and inner runs of whitespace. */
function cleanThinkingTailLine(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(THINKING_BLOCK_MARKER_PATTERN, "").trim();
}

function lastThinkingTailLine(text: string): string {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const cleaned = cleanThinkingTailLine(lines[i] ?? "");
		if (cleaned) return cleaned;
	}
	return "";
}

/** The cut can land on whitespace; drop the space directly after the ellipsis (the row may end one column short). */
function trimTailWhitespaceAfterEllipsis(tail: string): string {
	if (!tail.startsWith("…")) return tail;
	return `…${tail.slice(1).replace(/^\s+/, "")}`;
}

/** One collapsed row: `<label> <marker> <tail>` at `bodyWidth`, or null when the tail budget is too small. */
function buildCollapsedThinkingRow(run: AssistantContentRun, label: string, live: boolean, bodyWidth: number): string | null {
	// bodyWidth - 1 (Pi core Text left padding) - label - 1 - marker - 1
	const tailBudget = bodyWidth - safeVisibleWidth(label) - 4;
	if (tailBudget < COLLAPSED_TAIL_MIN_BUDGET) return null;

	const marker = live ? THINKING_TAIL_LIVE_MARKER : THINKING_TAIL_SETTLED_MARKER;
	const tail = trimTailWhitespaceAfterEllipsis(safeTakeTailToWidth(lastThinkingTailLine(run.text), tailBudget));
	const labelSegment = styleThinkingLine(label);
	const tailColor = getThemeExtra(activeTheme, "collapsedThinkingTailColor");
	const tailSegment = activeTheme ? fgHex(activeTheme, tailColor, `${marker} ${tail}`) : `${marker} ${tail}`;
	return ` ${labelSegment} ${tailSegment}`;
}

type ThinkingChildContext = {
	run: AssistantContentRun;
	hidden: boolean;
	live: boolean;
	label: string | null;
};

function isCollapsedTailEnabled(context: ThinkingChildContext | undefined): context is ThinkingChildContext & { label: string } {
	return Boolean(context && context.hidden && context.label !== null && loadConfig().collapsedThinking === "tail");
}

function makeThinkingChildPlain(child: any, mode: "plain" | "gutter" | "prefix", context?: ThinkingChildContext): void {
	if (!child || typeof child.render !== "function" || child.__plainThinkingPatched) return;
	child.__plainThinkingPatched = true;

	const baseRender = child.render.bind(child);
	child.render = (width: number): string[] => {
		const bodyWidth = mode === "plain" ? width : getAssistantBodyWidth(width);
		const collapsedRow = isCollapsedTailEnabled(context)
			? buildCollapsedThinkingRow(context.run, context.label, context.live, bodyWidth)
			: null;
		const lines = collapsedRow !== null ? [collapsedRow] : baseRender(bodyWidth).map(styleThinkingLine);
		if (mode === "prefix") return prefixFirstNonEmptyLine(lines, width);
		if (mode === "gutter") return addAssistantGutter(lines);
		return lines;
	};
}

/** True when a text, thinking or tool-call block sits after the run's last block, which settles it. */
function hasBlockAfter(content: any[], endBlockIndex: number): boolean {
	for (let i = endBlockIndex + 1; i < content.length; i++) {
		const type = content[i]?.type;
		if (type === "text" || type === "thinking" || type === "toolCall") return true;
	}
	return false;
}

function patchThinkingChildren(component: any, runs: AssistantContentRun[], message: any, liveStream: boolean): void {
	let turnMarkerUsed = false;
	let thinkingOrdinal = 0;
	const content = Array.isArray(message?.content) ? message.content : [];
	const label = typeof component?.hiddenThinkingLabel === "string" ? component.hiddenThinkingLabel : null;
	const visibilityOverrides = component?.thinkingVisibilityOverrides;

	for (let i = 0; i < runs.length; i++) {
		const run = runs[i];
		if (run.kind !== "thinking") continue;
		const hasTextAfter = runs.slice(i + 1).some((nextRun) => nextRun.kind === "text");
		const mode = hasTextAfter ? (turnMarkerUsed ? "gutter" : "prefix") : "plain";
		const override = typeof visibilityOverrides?.get === "function" ? visibilityOverrides.get(thinkingOrdinal) : undefined;
		const hidden = override ?? Boolean(component?.hideThinkingBlock);
		const live = liveStream && !hasBlockAfter(content, run.endBlockIndex);
		makeThinkingChildPlain(component?.contentContainer?.children?.[run.childIndex], mode, { run, hidden, live, label });
		if (mode === "prefix") turnMarkerUsed = true;
		thinkingOrdinal++;
	}
}

function isToolCallOnlyAssistantMessage(message: any): boolean {
	if (!message || !Array.isArray(message.content)) return false;
	const contentBlocks = message.content as any[];
	if (hasVisibleAssistantContent(contentBlocks)) return false;
	return contentBlocks.some((contentBlock) => contentBlock?.type === "toolCall");
}

function alignContinuationLines(lines: string[], targetIndex: number): void {
	const indent = " ".repeat(safeVisibleWidth(composePrefixedLine("")));
	for (let i = targetIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (stripAnsi(line).trim().length === 0) continue;
		lines[i] = `${indent}${dropLeadingColumns(line, 1)}`;
	}
}

function prefixFirstNonEmptyLine(lines: string[], width: number): string[] {
	if (width <= 0 || lines.length === 0) return lines;

	const compactPrefixBase = composePrefixedLine("");
	const compactPrefix =
		safeVisibleWidth(compactPrefixBase) > width ? safeTruncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
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
	alignContinuationLines(output, targetIndex);

	return output.map((renderedLine) =>
		safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine,
	);
}

export function installAssistantMessagePrefix(theme: any, componentClass: any = AssistantMessageComponent): void {
	activeTheme = theme;
	const proto = componentClass?.prototype as any;
	if (!proto) return;
	if (proto[PATCHED] || proto.render?.name === "patchedAssistantMessageRender") {
		proto[PATCHED] = true;
		return;
	}
	proto[PATCHED] = true;

	const baseUpdateContent = proto.updateContent;
	if (typeof baseUpdateContent === "function") {
		proto.updateContent = function patchedAssistantUpdateContent(message: any): void {
			// Tag before the base delegate so this wrapper's message is the identity the tag is built from.
			const liveStream = attachComponentToStream(this, message);
			baseUpdateContent.call(this, message);
			this.__assistantResponsePrefixChildMode = false;

			if (!message || !Array.isArray(message.content)) return;

			const runs = getAssistantContentRuns(this, message);
			patchThinkingChildren(this, runs, message, liveStream);

			const firstTextRunIndex = runs.findIndex((run) => run.kind === "text");
			if (firstTextRunIndex === -1) return;

			const hasThinkingBeforeText = runs.slice(0, firstTextRunIndex).some((run) => run.kind === "thinking");
			if (!hasThinkingBeforeText) return;
			this.__assistantResponsePrefixChildMode = true;

			const targetChild = this?.contentContainer?.children?.[runs[firstTextRunIndex].childIndex];

			if (!targetChild || typeof targetChild.render !== "function") return;

			const childState = targetChild as any;
			if (childState.__assistantResponsePrefixPatched) return;
			childState.__assistantResponsePrefixPatched = true;

			const baseChildRender = targetChild.render.bind(targetChild);
			targetChild.render = (width: number): string[] => addAssistantGutter(baseChildRender(getAssistantBodyWidth(width)));
		};
	}

	const baseRender = proto.render;

	proto.render = function patchedAssistantMessageRender(width: number): string[] {
		if (width <= 0) return baseRender.call(this, width);
		const lines = baseRender.call(this, this.__assistantResponsePrefixChildMode ? width : getAssistantBodyWidth(width));
		const design = getPresentationDesign();

		const compactPrefixBase = composePrefixedLine("");
		const compactPrefix =
			safeVisibleWidth(compactPrefixBase) > width ? safeTruncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
		const divider = buildDividerLine(width);

		if (lines.length === 0) {
			return lines;
		}

		if (this.__assistantResponsePrefixChildMode) {
			const result = lines.map((renderedLine) =>
				safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine,
			);
			if (design.compactLayout) return compactReasonixLines(result);
			const showDivider = getThemeExtra(activeTheme, "showDivider") !== "false";
			return showDivider ? [divider, ...result, ""] : [...result, ""];
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
		alignContinuationLines(output, targetIndex);

		const result = output.map((renderedLine) =>
			safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine,
		);

		if (design.compactLayout) return compactReasonixLines(result);

		// Add turn divider before assistant message
		const showDivider = getThemeExtra(activeTheme, "showDivider") !== "false";
		return showDivider ? [divider, ...result, ""] : [...result, ""];
	};
}
