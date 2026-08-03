import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { getPresentationStyle } from "../presentation/state.js";
import { getReasonixCollapsedRowWidth } from "../presentation/reasonix-layout.js";
import { safeTruncateToWidth, safeVisibleWidth, toSingleRenderLine, trimTrailingRenderPadding } from "../render-budget.js";
import { dropLeadingColumns, fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

const PATCH_FLAG = "__compactToolSpacingPatched__";
const PATCH_VERSION_KEY = "__compactToolSpacingPatchVersion__";
const RUNTIME_STATE_KEY = Symbol.for("pi-droid-styling.compact-tool-spacing.runtime-state");
const PATCH_VERSION = 10;

type ToolSpacingRuntimeState = {
	usesReasonix(): boolean;
	normalizeReasonix(lines: string[], width: number, expanded: boolean): string[];
	showDivider(): boolean;
	buildDivider(width: number): string;
};

let cachedTheme: any = null;

export function setToolSpacingTheme(theme: any): void {
	cachedTheme = theme;
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
	content[0] = truncateReasonixLine(toSingleRenderLine(content[0] ?? ""), rowWidth);
	if (expanded) {
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
	if (footerIndex < 0) return [content[0] ?? "", ""];
	return [content[0] ?? "", formatReasonixMetricsLine(content[footerIndex] ?? "", rowWidth), ""];
}

function normalizeBoxedLines(lines: string[]): string[] | undefined {
	const boxStart = lines.findIndex((line) => stripAnsi(line).startsWith("┌"));
	if (boxStart < 0) return undefined;
	let boxEnd = lines.length - 1;
	while (boxEnd > boxStart && stripAnsi(lines[boxEnd] ?? "").trim() === "") boxEnd--;
	return lines.slice(boxStart, boxEnd + 1);
}

/**
 * Normalizes ToolExecution spacing without stacking reload patches.
 * Reasonix removes outer dividers, keeps one spacer row, and folds collapsed
 * output into a header plus metrics connector. Droid keeps existing spacing.
 */
export function installCompactToolSpacing(ToolExecutionComponentClass: any = ToolExecutionComponent): void {
	const proto = ToolExecutionComponentClass?.prototype as any;
	if (!proto) return;

	// Pi reloads extension modules on session replacement while retaining the host
	// ToolExecutionComponent prototype. Refresh this delegate on every install so
	// the persistent wrapper reads the new session's presentation and theme state.
	proto[RUNTIME_STATE_KEY] = {
		usesReasonix: () => getPresentationStyle() === "reasonix",
		normalizeReasonix: normalizeReasonixToolLines,
		showDivider: () => getThemeExtra(cachedTheme, "showDivider") !== "false",
		buildDivider: buildDividerLine,
	} satisfies ToolSpacingRuntimeState;
	if (proto.render?.[PATCH_VERSION_KEY] === PATCH_VERSION) return;

	const globalState = globalThis as Record<string, unknown>;
	const legacyPatched = Boolean(globalState[PATCH_FLAG]);
	globalState[PATCH_FLAG] = true;

	const baseRender = proto.render;
	if (typeof baseRender !== "function") return;

	// Cache divider per width to keep stable string references across frames
	let cachedDivider = "";
	let cachedDividerWidth = -1;
	let cachedDividerRuntime: ToolSpacingRuntimeState | undefined;

	const patchedToolRender = function patchedToolRender(this: any, width: number): string[] {
		const lines = baseRender.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;
		const runtime = proto[RUNTIME_STATE_KEY] as ToolSpacingRuntimeState;

		if (runtime.usesReasonix()) {
			return runtime.normalizeReasonix(lines, width, Boolean(this.expanded));
		}

		const boxedLines = normalizeBoxedLines(lines);
		if (boxedLines) return boxedLines;

		// If this session already had the old patch installed, keep its non-boxed
		// spacing output instead of stacking a second divider/trailing blank.
		if (legacyPatched) return lines;

		if (!runtime.showDivider()) return [...lines, ""];
		if (cachedDividerWidth !== width || cachedDividerRuntime !== runtime) {
			cachedDivider = runtime.buildDivider(width);
			cachedDividerWidth = width;
			cachedDividerRuntime = runtime;
		}
		return [cachedDivider, ...lines, ""];
	};
	(patchedToolRender as any)[PATCH_VERSION_KEY] = PATCH_VERSION;
	proto.render = patchedToolRender;
}
