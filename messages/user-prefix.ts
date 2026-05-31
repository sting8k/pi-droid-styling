import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { dropLeadingColumns, fgHex, isHexColor, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

let activeTheme: any = null;
const PATCHED = Symbol.for("pi-droid-styling.user-prefix.patched");

function usesLegacyQuotePrefix(): boolean {
	return getThemeExtra(activeTheme, "quoteStyle") === "true" && getThemeExtra(activeTheme, "userPrefix") === "│";
}

function colorUserPrefix(text: string): string {
	const color = usesLegacyQuotePrefix() ? "accent" : getThemeExtra(activeTheme, "userPrefixColor");
	if (!activeTheme || !color) return text;
	if (isHexColor(color)) return fgHex(activeTheme, color, text);

	try {
		return typeof activeTheme.fg === "function" ? activeTheme.fg(color, text) : text;
	} catch {
		return text;
	}
}

function buildPrefixSegment(): string {
	const configuredChar = getThemeExtra(activeTheme, "userPrefix");
	const char = usesLegacyQuotePrefix() ? "❯" : configuredChar;
	const prefix = colorUserPrefix(char);
	if (typeof activeTheme?.bg === "function") {
		return activeTheme.bg("userMessageBg", `${prefix}  `);
	}
	return `${prefix}  `;
}

function buildDividerLine(width: number): string {
	if (width <= 0) return "";
	const char = getThemeExtra(activeTheme, "dividerChar");
	const color = getThemeExtra(activeTheme, "dividerColor");
	const line = char.repeat(width);
	return activeTheme ? fgHex(activeTheme, color, line) : line;
}
function stripEmphasisAnsi(text: string): string {
	return text.replace(/\x1b\[(?:(?:1|3|22|23);)*(?:1|3|22|23)m/g, "");
}

function buildContinuationSegment(): string {
	const char = getThemeExtra(activeTheme, "quoteChar") || "┆";
	const prefix = colorUserPrefix(char);
	if (typeof activeTheme?.bg === "function") {
		return activeTheme.bg("userMessageBg", `${prefix}  `);
	}
	return `${prefix}  `;
}

function alignContinuationLines(lines: string[], targetIndex: number): void {
	const continuationSegment = buildContinuationSegment();
	for (let i = targetIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const clean = stripAnsi(line);
		if (clean.trim().length === 0) {
			lines[i] = continuationSegment.trimEnd();
			continue;
		}
		lines[i] = `${continuationSegment}${dropLeadingColumns(line, 1)}`;
	}
}

export function installUserMessagePrefix(theme: any): void {
	activeTheme = theme;
	const proto = UserMessageComponent.prototype as any;
	if (proto[PATCHED] || proto.render?.name === "patchedUserMessageRender") {
		proto[PATCHED] = true;
		return;
	}
	proto[PATCHED] = true;

	const baseRender = proto.render;

	proto.render = function patchedUserMessageRender(width: number): string[] {
		const lines = baseRender.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;

		// Strip leading/trailing blank lines from base render (Spacer + Markdown paddingY)
		let first = 0;
		while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
		let last = lines.length - 1;
		while (last > first && stripAnsi(lines[last] ?? "").trim() === "") last--;
		const trimmed = lines.slice(first, last + 1);
		if (trimmed.length === 0) return lines;

		const output = [...trimmed];

		// Find first non-empty line to inject prefix
		let targetIndex = 0;
		for (let i = 0; i < output.length; i++) {
			const clean = stripAnsi(output[i] ?? "");
			if (clean.trim().length > 0) {
				targetIndex = i;
				break;
			}
		}

		const prefixSegment = buildPrefixSegment();
		const line = output[targetIndex] ?? "";
		const remainder = stripEmphasisAnsi(dropLeadingColumns(line, 1));
		output[targetIndex] = `${prefixSegment}${remainder}`;
		alignContinuationLines(output, targetIndex);

		const result = output.map((renderedLine) => {
			const plainLine = stripEmphasisAnsi(renderedLine);
			return visibleWidth(plainLine) > width ? truncateToWidth(plainLine, width, "") : plainLine;
		});

		// Add turn divider before user message
		const divider = buildDividerLine(width);
		const showDivider = getThemeExtra(activeTheme, "showDivider") !== "false";
		return showDivider ? [divider, "", ...result, ""] : ["", ...result, ""];
	};
}
