import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";

import { fgHex, hexToRgb, isHexColor } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

const PATCH_FLAG = "__defaultBadgePatched__";

const CUSTOM_TOOLS = new Set(["read", "write", "edit", "bash", "ls", "find", "grep"]);

let cachedTheme: any = null;

function formatBadgeLabel(toolName: string): string {
	return toolName.toUpperCase().replace(/[_-]/g, " ");
}

function makeBadge(t: any, label: string): string {
	const tagBg = getThemeExtra(t, "tagBgColor");
	return t.inverse(fgHex(t, tagBg, t.bold(` ${label} `)));
}

function makeBadgeFallback(label: string): string {
	const tagBg = getThemeExtra(null, "tagBgColor");
	const { r, g, b } = hexToRgb(isHexColor(tagBg) ? tagBg : "#79c0ff");
	return `\x1b[1m\x1b[48;2;${r};${g};${b}m\x1b[30m ${label} \x1b[0m`;
}

export function setDefaultBadgeTheme(theme: any): void {
	cachedTheme = theme;
}

export function installDefaultBadge(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = ToolExecutionComponent.prototype as any;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const baseUpdateDisplay = proto.updateDisplay;
	proto.updateDisplay = function patchedDefaultBadge(this: any, ...args: any[]) {
		const result = baseUpdateDisplay.apply(this, args);

		const toolName: string | undefined = this.toolName;
		if (!toolName || CUSTOM_TOOLS.has(toolName)) return result;

		const label = formatBadgeLabel(toolName);
		const badgeText = cachedTheme
			? makeBadge(cachedTheme, label)
			: makeBadgeFallback(label);

		// Case 1: contentBox with children (custom tool rendering path)
		if (this.contentBox?.children?.length > 0) {
			const firstChild = this.contentBox.children[0];
			if (firstChild && typeof firstChild.setText === "function") {
				const current: string = firstChild.text ?? "";
				// The existing text is typically: "toolName rest..." or styled "toolName"
				// Find where tool name ends and preserve the rest
				const plainName = toolName;
				const idx = current.indexOf(plainName);
				let rest = "";
				if (idx >= 0) {
					// Skip past the tool name and any ANSI reset sequences after it
					let afterName = idx + plainName.length;
					// Walk past trailing ANSI escape codes that belong to the name styling
					while (afterName < current.length && current[afterName] === "\x1b") {
						const end = current.indexOf("m", afterName);
						if (end >= 0) afterName = end + 1;
						else break;
					}
					rest = current.slice(afterName);
				}
				firstChild.setText(`${badgeText}${rest}`);
				return result;
			}
		}

		// Case 2: contentText (built-in fallback)
		if (this.contentText && typeof this.contentText.setText === "function") {
			const current: string = this.contentText.text ?? "";
			if (current) {
				const newlineIdx = current.indexOf("\n");
				if (newlineIdx >= 0) {
					this.contentText.setText(`${badgeText}${current.slice(newlineIdx)}`);
				} else {
					this.contentText.setText(badgeText);
				}
			}
		}

		return result;
	};
}
