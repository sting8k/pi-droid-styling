import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { getPresentationDesign } from "../presentation/state.js";
import { getReasonixCollapsedRowWidth } from "../presentation/reasonix-layout.js";
import { isImageRenderLine, safeTruncateToWidth, safeVisibleWidth, toSingleRenderLine, trimTrailingRenderPadding } from "../render-budget.js";
import { dropLeadingColumns, fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

const PATCH_FLAG = "__compactToolSpacingPatched__";
const LEGACY_CHAIN_FLAG = "__compactToolSpacingLegacyChain__";
const PATCH_VERSION_KEY = "__compactToolSpacingPatchVersion__";
const RUNTIME_STATE_KEY = Symbol.for("pi-droid-styling.compact-tool-spacing.runtime-state");
const PATCH_VERSION = 11;
// RUNTIME_STATE_KEY delegation shipped with wrapper version 10; older stamped
// wrappers (2-9) never read the delegate and still need to be wrapped over.
const DELEGATE_AWARE_PATCH_VERSION = 10;

type ToolSpacingRuntimeState = {
	usesReasonix(): boolean;
	normalizeReasonix(lines: string[], width: number, expanded: boolean): string[];
	showDivider(): boolean;
	buildDivider(width: number): string;
};

let cachedTheme: any = null;

export function setToolSpacingTheme(theme: any): void {
	cachedTheme = theme;
	cachedDividerWidth = -1;
}

function buildDividerLine(width: number): string {
	if (width <= 0) return "";
	const char = getThemeExtra(cachedTheme, "dividerChar");
	const color = getThemeExtra(cachedTheme, "dividerColor");
	const line = char.repeat(width);
	return cachedTheme ? fgHex(cachedTheme, color, line) : line;
}

function trimOuterBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && stripAnsi(lines[start] ?? "").trim() === "") start++;
	while (end > start && stripAnsi(lines[end - 1] ?? "").trim() === "") end--;
	return lines.slice(start, end);
}

/**
 * ToolExecutionComponent appends terminal image lines (kitty/iTerm2 escape
 * payloads) after the text content. stripAnsi() reduces them to empty strings,
 * so spacing normalization would silently trim them as blank lines. Split them
 * off (with their leading spacer) before normalizing and re-append after.
 */
function splitImageTail(lines: string[]): { content: string[]; tail: string[] } {
	const first = lines.findIndex(isImageRenderLine);
	if (first < 0) return { content: lines, tail: [] };
	let start = first;
	while (start > 0 && stripAnsi(lines[start - 1] ?? "").trim() === "") start--;
	return { content: lines.slice(0, start), tail: lines.slice(start) };
}

function appendImageTail(lines: string[], tail: string[]): string[] {
	if (tail.length === 0) return lines;
	let end = lines.length;
	while (end > 0 && stripAnsi(lines[end - 1] ?? "").trim() === "") end--;
	return [...lines.slice(0, end), ...tail, ""];
}

function isFullWidthDivider(line: string, width: number): boolean {
	const dividerChar = getThemeExtra(cachedTheme, "dividerChar");
	return Boolean(dividerChar) && stripAnsi(line) === dividerChar.repeat(width);
}

function reasonixEllipsis(): string {
	return cachedTheme?.fg?.("dim", " …") ?? " …";
}

function truncateReasonixLine(text: string, width: number): string {
	const content = trimTrailingRenderPadding(text);
	const rowWidth = Math.max(1, Math.floor(width));
	if (safeVisibleWidth(content) <= rowWidth) return content;
	return safeTruncateToWidth(content, rowWidth, reasonixEllipsis());
}

function colorReasonixConnector(line: string): string {
	const visible = stripAnsi(line);
	const connectorIndex = visible.indexOf("└─ ");
	if (connectorIndex < 0 || visible.slice(0, connectorIndex).trim().length > 0) return line;
	const remainder = dropLeadingColumns(line, connectorIndex + 3);
	const connector = cachedTheme?.fg?.("dim", "└─ ") ?? "└─ ";
	return `${" ".repeat(connectorIndex)}${connector}${remainder}`;
}

function formatReasonixMetricsLine(footerLine: string, width: number): string {
	const footer = toSingleRenderLine(footerLine).trimStart();
	const line = stripAnsi(footer).startsWith("└─ ") ? `  ${footer}` : `  └─ ${footer}`;
	return truncateReasonixLine(colorReasonixConnector(line), width);
}

export function normalizeReasonixToolLines(lines: string[], width: number, expanded: boolean): string[] {
	const content = trimOuterBlankLines(lines);
	while (content.length > 0 && isFullWidthDivider(content[0] ?? "", width)) content.shift();
	if (content.length === 0) return [];

	const rowWidth = expanded ? Math.max(1, width) : getReasonixCollapsedRowWidth(width);
	if (expanded) {
		content[0] = truncateReasonixLine(toSingleRenderLine(content[0] ?? ""), rowWidth);
		for (let index = 1; index < content.length; index++) {
			content[index] = truncateReasonixLine(colorReasonixConnector(content[index] ?? ""), rowWidth);
		}
		return [...content, ""];
	}

	let footerIndex = -1;
	for (let index = content.length - 1; index > 0; index--) {
		const plain = stripAnsi(content[index] ?? "").trimStart();
		if (!plain.includes("◷") && !(content.length === 2 && plain.startsWith("└─ "))) continue;
		footerIndex = index;
		break;
	}

	const outputIndex = content.findIndex((line, index) => index > 0 && stripAnsi(line).trimStart().startsWith("└─ "));
	const headerEnd = outputIndex >= 0 ? outputIndex : footerIndex >= 0 ? footerIndex : content.length;
	const headerRows = content.slice(0, Math.max(1, headerEnd)).map((line) => truncateReasonixLine(toSingleRenderLine(line), rowWidth));
	if (footerIndex < 0) return [...headerRows, ""];
	return [...headerRows, formatReasonixMetricsLine(content[footerIndex] ?? "", rowWidth), ""];
}

function normalizeBoxedLines(lines: string[]): string[] | undefined {
	const boxStart = lines.findIndex((line) => stripAnsi(line).startsWith("┌"));
	if (boxStart < 0) return undefined;
	let boxEnd = lines.length - 1;
	while (boxEnd > boxStart && stripAnsi(lines[boxEnd] ?? "").trim() === "") boxEnd--;
	return lines.slice(boxStart, boxEnd + 1);
}

// Cache divider per width to keep stable string references across frames.
// Reset by setToolSpacingTheme() whenever the session theme changes.
let cachedDivider = "";
let cachedDividerWidth = -1;

function legacyWrapperInChain(): boolean {
	return Boolean((globalThis as Record<string, unknown>)[LEGACY_CHAIN_FLAG]);
}

/**
 * Full spacing normalizer for every presentation style. Image lines appended
 * by the core component are split off first and re-appended untouched.
 * Reasonix removes outer dividers, keeps one spacer row, and folds collapsed
 * output into a header plus metrics connector. Droid keeps existing spacing.
 */
function normalizeToolRenderLines(lines: string[], width: number, expanded: boolean): string[] {
	const { content, tail } = splitImageTail(lines);

	if (getPresentationDesign().compactLayout) {
		return appendImageTail(normalizeReasonixToolLines(content, width, expanded), tail);
	}

	const boxedLines = normalizeBoxedLines(content);
	if (boxedLines) return appendImageTail(boxedLines, tail);

	// A pre-versioned legacy wrapper already added divider/trailing-blank
	// spacing; keep its non-boxed output instead of stacking a second divider.
	if (legacyWrapperInChain()) return lines;

	if (getThemeExtra(cachedTheme, "showDivider") === "false") return appendImageTail([...content, ""], tail);
	if (cachedDividerWidth !== width) {
		cachedDivider = buildDividerLine(width);
		cachedDividerWidth = width;
	}
	return appendImageTail([cachedDivider, ...content, ""], tail);
}

/**
 * Normalizes ToolExecution spacing without stacking reload patches.
 *
 * The render wrapper is installed at most once per host prototype and stays
 * behavior-free: all normalization flows through the RUNTIME_STATE_KEY
 * delegate, which is refreshed on every install. Wrappers left behind by
 * earlier module versions also read this delegate, so they pick up current
 * behavior (usesReasonix() is pinned true so old wrappers route every style
 * through the delegate instead of their stale inline droid/boxed paths that
 * would drop terminal image lines).
 */
export function installCompactToolSpacing(ToolExecutionComponentClass: any = ToolExecutionComponent): void {
	const proto = ToolExecutionComponentClass?.prototype as any;
	if (!proto || typeof proto.render !== "function") return;

	const globalState = globalThis as Record<string, unknown>;
	const existingVersion = proto.render[PATCH_VERSION_KEY];
	const existingDelegateAware = typeof existingVersion === "number" && existingVersion >= DELEGATE_AWARE_PATCH_VERSION;
	// Decide once per process whether a delegate-less wrapper (legacy unstamped
	// or version 2-9) already added its own spacing to the render chain.
	if (!(LEGACY_CHAIN_FLAG in globalState)) {
		globalState[LEGACY_CHAIN_FLAG] = Boolean(globalState[PATCH_FLAG]) && !existingDelegateAware;
	}
	globalState[PATCH_FLAG] = true;

	proto[RUNTIME_STATE_KEY] = {
		usesReasonix: () => true,
		normalizeReasonix: normalizeToolRenderLines,
		showDivider: () => getThemeExtra(cachedTheme, "showDivider") !== "false",
		buildDivider: buildDividerLine,
	} satisfies ToolSpacingRuntimeState;

	// A delegate-aware wrapper (version >= 10, this or an earlier module version)
	// already routes through RUNTIME_STATE_KEY; never stack a second wrapper on it.
	if (existingDelegateAware) return;

	const baseRender = proto.render;
	const patchedToolRender = function patchedToolRender(this: any, width: number): string[] {
		const rendered = baseRender.call(this, width);
		if (rendered.length === 0 || width <= 0) return rendered;
		const runtime = proto[RUNTIME_STATE_KEY] as ToolSpacingRuntimeState;
		return runtime.normalizeReasonix(rendered, width, Boolean(this.expanded));
	};
	(patchedToolRender as any)[PATCH_VERSION_KEY] = PATCH_VERSION;
	proto.render = patchedToolRender;
}
