import { UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { dropLeadingColumns, fgHex, stripAnsi } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

let activeTheme: any = null;
let isPatched = false;

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

export function installUserMessagePrefix(theme: any): void {
	activeTheme = theme;
	if (isPatched) return;
	isPatched = true;

	const baseRender = UserMessageComponent.prototype.render;

	UserMessageComponent.prototype.render = function patchedUserMessageRender(width: number): string[] {
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
			const prefixChar = getThemeExtra(activeTheme, "userPrefix");
			const quoteColor = getThemeExtra(activeTheme, "quoteColor");
			const border = activeTheme ? fgHex(activeTheme, quoteColor, prefixChar) : prefixChar;

			result = output.map((line) => {
				const remainder = dropLeadingColumns(line, 1);
				const plain = stripAnsi(remainder).trimEnd();
				const colored = activeTheme
					? `\x1b[1m\x1b[3m${fgHex(activeTheme, quoteColor, plain)}\x1b[23m\x1b[22m`
					: `\x1b[1m\x1b[3m${plain}\x1b[23m\x1b[22m`;
				const quoted = `${border} ${colored}`;
				return visibleWidth(quoted) > width ? truncateToWidth(quoted, width, "") : quoted;
			});
		} else {
			const prefixSegment = buildPrefixSegment();
			const line = output[targetIndex] ?? "";
			const remainder = dropLeadingColumns(line, 1);
			output[targetIndex] = `${prefixSegment}${remainder}`;

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
