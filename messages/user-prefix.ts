import { UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { dropLeadingColumns, fgHex, stripAnsi } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

let activeTheme: any = null;
const PATCHED = Symbol.for("pi-droid-styling.user-prefix.patched");

function buildPrefixSegment(): string {
	const char = getThemeExtra(activeTheme, "userPrefix");
	const color = getThemeExtra(activeTheme, "userPrefixColor");
	const prefix = activeTheme ? fgHex(activeTheme, color, char) : char;
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

function alignContinuationLines(lines: string[], targetIndex: number): void {
	const indent = " ".repeat(visibleWidth(buildPrefixSegment()));
	for (let i = targetIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (stripAnsi(line).trim().length === 0) continue;
		lines[i] = `${indent}${dropLeadingColumns(line, 1)}`;
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

		const quoteStyle = getThemeExtra(activeTheme, "quoteStyle") === "true";
		let result: string[];

		if (quoteStyle) {
			const quoteColor = getThemeExtra(activeTheme, "quoteColor");
			const quoteChar = getThemeExtra(activeTheme, "quoteChar") || "│";
			const border = activeTheme && quoteColor ? fgHex(activeTheme, quoteColor, quoteChar) : quoteChar;

			const verticalBarChars = new Set([
				"│", "┃", "¦", "║", "╎", "╏", "┆", "┇", "┊", "┋", "︱", "︲", "￨", "|",
			]);

			const findBarIndex = (stripped: string): number => {
				for (let i = 0; i < stripped.length; i++) {
					if (verticalBarChars.has(stripped[i]!)) return i;
				}
				return -1;
			};

			// Extract content lines, stripping blockquote structure
			// Also strip OSC sequences (e.g. shell integration markers \x1b]....\x07)
			const stripOsc = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "");
			const contentLines: string[] = [];
			for (const line of output) {
				const stripped = stripOsc(stripAnsi(line));
				const trimmed = stripped.trim();

				if (trimmed.length === 0) continue;

				const barIdx = findBarIndex(stripped);
				if (barIdx >= 0) {
					const afterBar = stripped.slice(barIdx + 1);
					const text = afterBar.trimEnd();
					if (text.replace(/\s/g, "").length > 0) {
						contentLines.push(text.startsWith(" ") ? text.slice(1) : text);
					}
				} else {
					const meaningful = trimmed.replace(/[\s│┃¦║╎╏┆┇┊┋︱︲￨|>]/gu, "");
					if (meaningful.length > 0) {
						contentLines.push(trimmed);
					}
				}
			}

			if (contentLines.length === 0) {
				for (const line of output) {
					const t = stripAnsi(line).trim();
					if (t.length > 0) contentLines.push(t);
				}
			}

			result = contentLines.map((text) => {
				const colored = activeTheme && quoteColor
					? `\x1b[1m\x1b[3m${fgHex(activeTheme, quoteColor, text)}\x1b[23m\x1b[22m`
					: `\x1b[1m\x1b[3m${text}\x1b[23m\x1b[22m`;
				const quoted = `${border} ${colored}`;
				return visibleWidth(quoted) > width ? truncateToWidth(quoted, width, "") : quoted;
			});
		} else {
			const prefixSegment = buildPrefixSegment();
			const line = output[targetIndex] ?? "";
			const remainder = dropLeadingColumns(line, 1);
			output[targetIndex] = `${prefixSegment}${remainder}`;
			alignContinuationLines(output, targetIndex);

			result = output.map((renderedLine) => {
				const bolded = activeTheme ? activeTheme.bold(renderedLine) : renderedLine;
				return visibleWidth(bolded) > width ? truncateToWidth(bolded, width, "") : bolded;
			});
		}

		// Add turn divider before user message
		const divider = buildDividerLine(width);
		const showDivider = getThemeExtra(activeTheme, "showDivider") !== "false";
		return showDivider ? [divider, "", ...result, ""] : ["", ...result, ""];
	};
}
