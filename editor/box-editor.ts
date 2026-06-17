import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { homedir, hostname, userInfo } from "node:os";

import { safeWrapTextWithAnsi, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";
import { resolveUserZoneStyle, type UserZoneStyle } from "../user-zone/designs.js";

type SlashAutocompleteItem = {
	value?: string;
	label?: string;
	description?: string;
};

type SlashAutocompleteModel = {
	items: SlashAutocompleteItem[];
	selectedIndex: number;
	maxVisible: number;
	showSlashPrefix: boolean;
};

type ContextUsageProvider = () =>
	| {
			tokens: number | null;
			percent: number | null;
			contextWindow: number;
	  }
	| undefined;

type ModelInfoProvider = () => {
	provider?: string;
	id?: string;
	name?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
} | undefined;

type InputBoxStyleOverride = "auto" | "halfblock" | "line" | "solid";
type ResolvedInputFrame = "none" | "halfblock" | "line" | "solid" | "outline";

type BranchInfo = {
	branch: string;
	insertions?: number;
	deletions?: number;
};

type BranchProvider = () => BranchInfo | null;
type ResponseSpeedProvider = () => number | null;
type FooterStatusProvider = () => string | null;
type MetadataPlacementProvider = () => "footer" | "sidebar";

function isBorderLine(line: string): boolean {
	const clean = stripAnsi(line).replace(/\s/g, "");
	return clean.replace(/─/g, "").replace(/[↑↓]\s*\d+\s*more/g, "") === "";
}

function findLastBorderIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (isBorderLine(lines[i] ?? "")) return i;
	}
	return -1;
}

function normalizeSingleLine(text: string): string {
	return text.replace(/[\r\n]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isHexColor(value: string): boolean {
	return /^#?[0-9a-fA-F]{3}$/.test(value) || /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

function backgroundAnsiToForegroundAnsi(ansi: string): string {
	return ansi.replace(/\x1b\[([0-9;]*)m/g, (_sequence, rawCodes: string) => {
		const codes = rawCodes.split(";").filter((code) => code.length > 0);
		if (codes.length === 0) return "\x1b[0m";

		const rebuilt: string[] = [];
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i]!;
			const numeric = Number(code);
			if (numeric === 38 || numeric === 48) {
				rebuilt.push(numeric === 48 ? "38" : code);
				const mode = codes[i + 1];
				const parameterCount = mode === "2" ? 4 : mode === "5" ? 2 : 0;
				for (let j = 1; j <= parameterCount && i + j < codes.length; j++) rebuilt.push(codes[i + j]!);
				i += parameterCount;
				continue;
			}
			if (numeric === 49) {
				rebuilt.push("39");
				continue;
			}
			if (numeric >= 40 && numeric <= 47) {
				rebuilt.push(String(numeric - 10));
				continue;
			}
			if (numeric >= 100 && numeric <= 107) {
				rebuilt.push(String(numeric - 10));
				continue;
			}
			rebuilt.push(code);
		}

		return `\x1b[${rebuilt.join(";")}m`;
	});
}

function firstCodePoint(text: string): string {
	const next = text[Symbol.iterator]().next();
	return next.done ? "" : next.value;
}

function currentUsername(): string {
	try {
		return userInfo().username || process.env.USER || process.env.LOGNAME || "user";
	} catch {
		return process.env.USER || process.env.LOGNAME || "user";
	}
}
function currentUserHost(): string {
	const user = currentUsername();
	const host = hostname().split(".")[0] || "host";
	return `${user}@${host}`;
}

export class BoxEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		kb: any,
		private readonly fullTheme: any,
		private readonly sessionCwd: string,
		private readonly getContextUsage?: ContextUsageProvider,
		private readonly getModelInfo?: ModelInfoProvider,
		private readonly getBranch?: BranchProvider,
		private readonly getResponseSpeed?: ResponseSpeedProvider,
		private readonly getFooterStatus?: FooterStatusProvider,
		private readonly getMetadataPlacement?: MetadataPlacementProvider,
		private readonly userZoneStyle: UserZoneStyle = resolveUserZoneStyle(undefined),
		private readonly inputBoxStyle?: InputBoxStyleOverride,
	) {
		super(tui, theme, kb);
	}

	private color(hex: string, text: string): string {
		return this.fullTheme ? fgHex(this.fullTheme, hex, text) : text;
	}

	private styleFg(color: string, text: string): string {
		return isHexColor(color) ? this.color(color, text) : this.tone(color, text);
	}

	private styleBackgroundAsFg(color: string, text: string): string {
		if (isHexColor(color)) return this.color(color, text);
		try {
			if (typeof this.fullTheme?.getBgAnsi === "function") {
				const bgAnsi = this.fullTheme.getBgAnsi(color);
				if (typeof bgAnsi === "string" && bgAnsi.length > 0) {
					return `${backgroundAnsiToForegroundAnsi(bgAnsi)}${text}\x1b[39m`;
				}
			}
		} catch {
			// Fall through to fg styling when a theme lacks a background token.
		}
		return this.styleFg(color, text);
	}

	private themeExtraColor(key: string, fallback: string): string {
		return getThemeExtra(this.fullTheme, key) || fallback;
	}

	private metadataInSidebar(): boolean {
		return this.getMetadataPlacement?.() === "sidebar";
	}

	private getSlashAutocompleteModel(): SlashAutocompleteModel | null {
		const editorState = (this as any)?.state as
			| {
					lines?: string[];
					cursorLine?: number;
					cursorCol?: number;
			  }
			| undefined;
		if (!editorState || !Array.isArray(editorState.lines)) return null;

		const cursorLine = typeof editorState.cursorLine === "number" ? editorState.cursorLine : 0;
		const cursorCol = typeof editorState.cursorCol === "number" ? editorState.cursorCol : 0;
		const currentLine = editorState.lines[cursorLine] ?? "";
		const textBeforeCursor = currentLine.slice(0, Math.max(0, cursorCol));

		const trimmedBeforeCursor = textBeforeCursor.trimStart();
		if (cursorLine !== 0 || !trimmedBeforeCursor.startsWith("/")) return null;

		const autocompleteState = (this as any)?.autocompleteState;
		const autocompleteList = (this as any)?.autocompleteList as
			| {
					filteredItems?: SlashAutocompleteItem[];
					selectedIndex?: number;
					maxVisible?: number;
			  }
			| undefined;

		if (!autocompleteState || !autocompleteList) return null;

		const items = Array.isArray(autocompleteList.filteredItems) ? autocompleteList.filteredItems : [];
		const selectedIndex = clamp(
			typeof autocompleteList.selectedIndex === "number" ? autocompleteList.selectedIndex : 0,
			0,
			Math.max(0, items.length - 1),
		);
		const maxVisible = clamp(
			typeof autocompleteList.maxVisible === "number" ? autocompleteList.maxVisible : 6,
			1,
			20,
		);

		return {
			items,
			selectedIndex,
			maxVisible,
			showSlashPrefix: !trimmedBeforeCursor.includes(" "),
		};
	}

	private formatSlashAutocompleteRow(
		item: SlashAutocompleteItem,
		isSelected: boolean,
		width: number,
		showSlashPrefix: boolean,
	): string {
		const rawCommand = normalizeSingleLine(item.label || item.value || "");
		const command =
			showSlashPrefix && rawCommand.length > 0 && !rawCommand.startsWith("/") ? `/${rawCommand}` : rawCommand;
		const description = typeof item.description === "string" ? normalizeSingleLine(item.description) : "";
		const prefix = isSelected ? "> " : "  ";
		const prefixWidth = safeVisibleWidth(prefix);

		if (description && width > 40) {
			const maxCommandWidth = Math.min(30, Math.max(8, width - prefixWidth - 10));
			const commandText = safeTruncateToWidth(command, maxCommandWidth, "");
			const spacing = " ".repeat(Math.max(1, 32 - safeVisibleWidth(commandText)));
			const remaining = width - prefixWidth - safeVisibleWidth(commandText) - safeVisibleWidth(spacing);

			if (remaining > 8) {
				const descriptionText = safeTruncateToWidth(description, remaining, "");
				if (isSelected) {
					return this.color(getThemeExtra(this.fullTheme, "slashSelectedColor"), `${prefix}${commandText}${spacing}${descriptionText}`);
				}
				const commandColored = this.color(getThemeExtra(this.fullTheme, "slashCommandColor"), commandText);
				const descriptionColored = this.color(getThemeExtra(this.fullTheme, "slashDescriptionColor"), `${spacing}${descriptionText}`);
				return `${prefix}${commandColored}${descriptionColored}`;
			}
		}

		const commandOnly = safeTruncateToWidth(command, Math.max(1, width - prefixWidth), "");
		if (isSelected) return this.color(getThemeExtra(this.fullTheme, "slashSelectedColor"), `${prefix}${commandOnly}`);
		return `${prefix}${this.color(getThemeExtra(this.fullTheme, "slashCommandColor"), commandOnly)}`;
	}

	private renderSlashAutocomplete(width: number, border: (text: string) => string): string[] | null {
		const model = this.getSlashAutocompleteModel();
		if (!model) return null;

		const totalItems = model.items.length;
		const innerWidth = Math.max(1, width - 2);

		const startIndex =
			totalItems > 0
				? Math.max(
						0,
						Math.min(
							model.selectedIndex - Math.floor(model.maxVisible / 2),
							Math.max(0, totalItems - model.maxVisible),
						),
				  )
				: 0;
		const endIndex = Math.min(startIndex + model.maxVisible, totalItems);
		const visibleItems = model.items.slice(startIndex, endIndex);

		const lines: string[] = [];
		lines.push(" ".repeat(width));

		lines.push(border(`┌${"─".repeat(innerWidth)}┐`));
		if (visibleItems.length === 0) {
			const noMatch = this.color(getThemeExtra(this.fullTheme, "slashDescriptionColor"), "  No matching commands");
			const paddedNoMatch = `${noMatch}${" ".repeat(Math.max(0, innerWidth - safeVisibleWidth(noMatch)))}`;
			lines.push(`${border("│")}${paddedNoMatch}${border("│")}`);
		} else {
			for (let i = 0; i < visibleItems.length; i++) {
				const item = visibleItems[i];
				if (!item) continue;

				const itemIndex = startIndex + i;
				const row = this.formatSlashAutocompleteRow(
					item,
					itemIndex === model.selectedIndex,
					innerWidth,
					model.showSlashPrefix,
				);
				const paddedRow = `${row}${" ".repeat(Math.max(0, innerWidth - safeVisibleWidth(row)))}`;
				lines.push(`${border("│")}${paddedRow}${border("│")}`);
			}
		}
		lines.push(border(`└${"─".repeat(innerWidth)}┘`));

		const shownStart = visibleItems.length > 0 ? startIndex + 1 : 0;
		const shownEnd = startIndex + visibleItems.length;
		const hint = ` Use ↑↓ to navigate, Tab/Enter to select, Esc to cancel  Showing ${shownStart}-${shownEnd} of ${totalItems}`;
		const coloredHint = this.color(getThemeExtra(this.fullTheme, "slashHintColor"), hint);
		const truncatedHint = safeVisibleWidth(coloredHint) > width ? safeTruncateToWidth(coloredHint, width, "") : coloredHint;
		lines.push(`${truncatedHint}${" ".repeat(Math.max(0, width - safeVisibleWidth(truncatedHint)))}`);

		return lines;
	}

	private tone(color: string, text: string): string {
		try {
			return typeof this.fullTheme?.fg === "function" ? this.fullTheme.fg(color, text) : text;
		} catch {
			return text;
		}
	}

	private bg(color: string, text: string): string {
		try {
			return typeof this.fullTheme?.bg === "function" ? this.fullTheme.bg(color, text) : text;
		} catch {
			return text;
		}
	}

	private bold(text: string): string {
		return typeof this.fullTheme?.bold === "function" ? this.fullTheme.bold(text) : text;
	}

	private pad(content: string, width: number): string {
		const truncated = safeVisibleWidth(content) > width ? safeTruncateToWidth(content, width, "") : content;
		return `${truncated}${" ".repeat(Math.max(0, width - safeVisibleWidth(truncated)))}`;
	}

	private padLeft(content: string, width: number): string {
		const truncated = safeVisibleWidth(content) > width ? safeTruncateToWidth(content, width, "") : content;
		return `${" ".repeat(Math.max(0, width - safeVisibleWidth(truncated)))}${truncated}`;
	}

	private formatCompactTokens(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		if (count < 1000000) return `${Math.round(count / 1000)}k`;
		if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
		return `${Math.round(count / 1000000)}M`;
	}

	private contextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | null {
		const usage = this.getContextUsage?.();
		if (!usage || !usage.contextWindow) return null;
		const percent = typeof usage.percent === "number" && Number.isFinite(usage.percent)
			? usage.percent
			: typeof usage.tokens === "number" && usage.contextWindow > 0
				? (usage.tokens / usage.contextWindow) * 100
				: null;
		return { tokens: usage.tokens, contextWindow: usage.contextWindow, percent };
	}

	private formatTokenBar(percent: number | null): string {
		if (percent === null || !Number.isFinite(percent)) return "";
		const total = 12;
		const filled = Math.max(0, Math.min(total, Math.round((percent / 100) * total)));
		const fillColor = percent > 75 ? "error" : percent >= 50 ? "warning" : "accent";
		const full = filled > 0 ? this.tone(fillColor, "━".repeat(filled)) : "";
		const empty = filled < total ? this.tone("borderMuted", "━".repeat(total - filled)) : "";
		return `${full}${empty}`;
	}

	private formatTokenMeter(showLabel = true): string | null {
		const usage = this.contextUsage();
		if (!usage || usage.percent === null) return null;

		const tokenCount = typeof usage.tokens === "number" && Number.isFinite(usage.tokens)
			? this.formatCompactTokens(usage.tokens)
			: "";
		const usageText = `${usage.percent.toFixed(1)}%/${this.formatCompactTokens(usage.contextWindow)}`;
		const detail = tokenCount
			? `${this.tone("muted", tokenCount)} ${this.tone("bashMode", "●")} ${this.tone("muted", usageText)}`
			: this.tone("muted", usageText);
		const meter = `${this.formatTokenBar(usage.percent)} ${detail}`;
		return showLabel ? `${this.tone("dim", "Tokens:")}  ${meter}` : meter;
	}

	private formatResponseSpeedBadge(): string | null {
		const speed = this.getResponseSpeed?.();
		if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
		const rounded = speed >= 100 ? Math.round(speed).toString() : speed.toFixed(1).replace(/\.0$/, "");
		return `${rounded} words/s`;
	}

	private formatModelBadge(): { plain: string; rendered: string } | null {
		const info = this.getModelInfo?.();
		if (!info || !info.id) return null;
		const provider = info.provider ? `[${String(info.provider).toUpperCase()}] ` : "";
		const level = info.reasoning && info.thinkingLevel
			? info.thinkingLevel === "off" ? " (thinking off)" : ` (${info.thinkingLevel})`
			: "";
		const plain = `${provider}${info.id}${level}`;
		return {
			plain,
			rendered: this.bg("selectedBg", ` ${this.tone("muted", provider)}${this.tone("text", `${info.id}${level}`)} `),
		};
	}

	private formatGeminiModelBadge(): { plain: string; rendered: string } | null {
		const info = this.getModelInfo?.();
		if (!info || !info.id) return null;

		const provider = typeof info.provider === "string" && info.provider.trim().length > 0
			? info.provider.trim().toLowerCase()
			: "";
		const id = String(info.id).trim();
		if (!id) return null;
		const level = info.reasoning && typeof info.thinkingLevel === "string" && info.thinkingLevel.trim().length > 0
			? info.thinkingLevel.trim()
			: "";

		const plain = `${provider ? `${provider} ` : ""}${id}${level ? ` · ${level}` : ""}`;
		const rendered = [
			provider ? `${this.tone("dim", provider)} ` : "",
			this.tone("muted", id),
			level ? `${this.tone("muted", " · ")}${this.tone("accent", level)}` : "",
		].join("");

		return { plain, rendered };
	}

	private formatCwd(): string {
		const home = homedir().replace(/\\/g, "/");
		const normalized = (this.sessionCwd || process.cwd()).replace(/\\/g, "/");
		const display = normalized.startsWith(home) ? `~${normalized.slice(home.length)}` : normalized;
		const parts = display.split("/").filter(Boolean);
		if (display.startsWith("~")) parts[0] = "~";
		if (parts.length <= 3) return parts.join("/") || ".";
		return `${parts[0]}.../${parts.slice(-2).join("/")}`;
	}

	private panelContentWidth(width: number): number {
		const paddingX = this.userZoneStyle.editor.panelPaddingX;
		const sidePadding = Math.min(paddingX, Math.floor(Math.max(0, width - 1) / 2));
		return Math.max(1, width - sidePadding * 2);
	}

	private formatBranchBadge(): { plain: string; rendered: string } | null {
		const info = this.getBranch?.();
		if (!info?.branch) return null;
		const icon = "⎇";
		const diffPlain = [
			info.insertions ? `[+${info.insertions}]` : "",
			info.deletions ? `[-${info.deletions}]` : "",
		].filter(Boolean);
		const plain = [icon, info.branch, ...diffPlain].join(" ");
		const renderedDiff = [
			info.insertions ? this.tone("success", `[+${info.insertions}]`) : "",
			info.deletions ? this.tone("error", `[-${info.deletions}]`) : "",
		].filter(Boolean).join(" ");
		const rendered = [
			this.tone("bashMode", icon),
			this.tone("mdLinkUrl", info.branch),
			renderedDiff,
		].filter(Boolean).join(" ");
		return { plain, rendered };
	}

	private renderPanelLine(content: string, width: number): string {
		const paddingX = this.userZoneStyle.editor.panelPaddingX;
		const sidePadding = Math.min(paddingX, Math.floor(Math.max(0, width - 1) / 2));
		const sidePad = " ".repeat(sidePadding);
		const contentWidth = Math.max(1, width - sidePadding * 2);
		return `${sidePad}${this.pad(content, contentWidth)}${sidePad}`;
	}

	private renderTopBorder(width: number): string {
		const style = this.userZoneStyle.editor;
		const borderColor = this.themeExtraColor("inputBorderColor", style.hostBorderColor);
		const prefix = this.styleFg(style.hostPrefixColor, `== [${currentUserHost()}] == `);
		const remaining = Math.max(0, width - safeVisibleWidth(prefix));
		const fill = style.hostBorderFill || " ";
		return `${prefix}${this.styleFg(borderColor, fill.repeat(remaining))}`;
	}

	private renderDivider(width: number): string {
		const style = this.userZoneStyle.editor;
		const dividerColor = this.themeExtraColor("inputBorderColor", style.dividerColor);
		const divider = this.styleFg(dividerColor, (style.dividerChar || " ").repeat(Math.max(1, width)));
		return style.dividerBold ? this.bold(divider) : divider;
	}

	private formatCellLabel(label: string): string {
		return ` ${this.pad(this.tone("accent", `[${label}]`), 7)} `;
	}

	private renderTopRow(width: number): string {
		const sep = this.tone("borderMuted", "│");
		const model = this.formatModelBadge();
		const showFooterMetadata = !this.metadataInSidebar();
		const path = showFooterMetadata ? `${this.formatCellLabel("env")}${this.tone("accent", this.formatCwd())}` : null;
		const leftParts = [path, model?.rendered].filter(Boolean);
		let left = leftParts.join(` ${sep} `);
		const branch = showFooterMetadata ? this.formatBranchBadge() : null;
		const right = branch ? `${sep} ${branch.rendered}` : "";
		const rightPlainWidth = branch ? safeVisibleWidth(`│ ${branch.plain}`) : 0;
		const available = Math.max(1, width - rightPlainWidth - (right ? 1 : 0));
		const trimmedMain = safeVisibleWidth(left) > available ? safeTruncateToWidth(left, available, "…") : left;
		const gap = right ? " ".repeat(Math.max(1, width - safeVisibleWidth(trimmedMain) - rightPlainWidth)) : "";
		return this.pad(`${trimmedMain}${gap}${right}`, width);
	}

	private renderInputContentLines(text: string, width: number): string[] {
		const logicalLines = text.length > 0 ? text.split("\n") : [""];
		const cursor = this.getCursor();
		const cursorLine = clamp(cursor.line, 0, logicalLines.length - 1);
		const rendered: string[] = [];

		for (let i = 0; i < logicalLines.length; i++) {
			const rawLine = logicalLines[i] ?? "";
			const isCursorLine = i === cursorLine;
			let line = rawLine;

			if (isCursorLine) {
				const displayCursorCol = clamp(cursor.col, 0, rawLine.length);
				const before = rawLine.slice(0, displayCursorCol);
				const after = rawLine.slice(displayCursorCol);
				const cursorGlyph = firstCodePoint(after);
				const atCursor = cursorGlyph || " ";
				const rest = cursorGlyph ? after.slice(cursorGlyph.length) : after;
				const marker = this.focused ? CURSOR_MARKER : "";
				line = `${before}${marker}\x1b[7m${atCursor}\x1b[27m${rest}`;
			}

			const wrapped = safeWrapTextWithAnsi(line, width);
			rendered.push(...(wrapped.length > 0 ? wrapped : [""]));
		}

		return rendered.length > 0 ? rendered : [`${this.focused ? CURSOR_MARKER : ""}\x1b[7m \x1b[27m`];
	}

	private formatRuntimeParts(showTokenLabel = true): string[] {
		const bullet = this.tone("bashMode", "●");
		const tokenMeter = this.formatTokenMeter(showTokenLabel);
		const speedBadge = this.formatResponseSpeedBadge();
		return [
			tokenMeter,
			speedBadge ? `${bullet} ${this.tone("muted", speedBadge)}` : null,
		].filter((part): part is string => Boolean(part));
	}

	private renderSplitRow(left: string, right: string, rightPlain: string, width: number): string {
		if (!rightPlain) return this.pad(left, width);
		const rightWidth = safeVisibleWidth(rightPlain);
		const availableLeft = Math.max(1, width - rightWidth - 2);
		const trimmedLeft = safeVisibleWidth(left) > availableLeft ? safeTruncateToWidth(left, availableLeft, "…") : left;
		const gap = " ".repeat(Math.max(2, width - safeVisibleWidth(trimmedLeft) - rightWidth));
		return this.pad(`${trimmedLeft}${gap}${right}`, width);
	}

	private renderRuntimeRow(width: number): string {
		const usageParts = this.formatRuntimeParts();
		const left = usageParts.length > 0 ? `${this.formatCellLabel("stat")}${usageParts.join("  ")}` : this.formatCellLabel("stat").trimEnd();
		const footerStatus = this.metadataInSidebar() ? "" : (this.getFooterStatus?.() ?? "");
		const rightPlain = normalizeSingleLine(stripAnsi(footerStatus));
		const right = this.tone("dim", rightPlain);
		return this.renderSplitRow(left, right, rightPlain, width);
	}

	private renderGeminiStatusRow(width: number): string {
		const runtime = this.formatRuntimeParts(false).join("  ");
		const model = this.formatGeminiModelBadge();
		const sep = this.tone("borderMuted", "│");
		const left = [model?.rendered, runtime]
			.filter((part): part is string => Boolean(part && stripAnsi(part).trim().length > 0))
			.join(` ${sep} `);
		const branch = this.metadataInSidebar() ? null : this.formatBranchBadge();
		const rightPlain = branch?.plain ?? "";
		const right = branch?.rendered ?? "";
		return this.renderSplitRow(left, right, rightPlain, width);
	}

	private renderGeminiDivider(width: number): string {
		const style = this.userZoneStyle.editor;
		const divider = this.styleFg(style.dividerColor || "border", "─".repeat(Math.max(1, width)));
		return style.dividerBold ? this.bold(divider) : divider;
	}

	private resolveInputFrame(): ResolvedInputFrame {
		const presetFrame = this.userZoneStyle.editor.inputFrame;
		const frame = this.inputBoxStyle && this.inputBoxStyle !== "auto"
			? this.inputBoxStyle
			: presetFrame;

		if (this.userZoneStyle.name === "droid-cli") return "outline";
		if (frame === "line" && this.userZoneStyle.name === "droid") return "none";
		if (frame === "line" || frame === "halfblock" || frame === "none" || frame === "solid" || frame === "outline") return frame;
		return process.env.NO_COLOR ? "line" : "halfblock";
	}

	private renderInputLineBorder(width: number): string {
		const style = this.userZoneStyle.editor;
		return this.styleBackgroundAsFg(style.inputBackgroundColor, (style.dividerChar || "─").repeat(Math.max(1, width)));
	}

	private renderInputBoxFrame(inputLines: string[], width: number): string[] {
		const style = this.userZoneStyle.editor;
		const inputFrame = this.resolveInputFrame();
		if (inputFrame === "line") {
			const border = this.renderInputLineBorder(width);
			return [border, ...inputLines.map((line) => this.pad(line, width)), border];
		}
		if (inputFrame === "none") return inputLines;
		if (inputFrame === "outline") {
			const borderColor = this.userZoneStyle.name === "droid-cli"
				? (style.slashBorderColor || style.dividerColor)
				: this.themeExtraColor("inputBorderColor", style.slashBorderColor || style.dividerColor);
			const border = (value: string) => this.styleFg(borderColor, value);
			const innerWidth = Math.max(1, width - 2);
			if (width <= 2) return inputLines.map((line) => this.pad(line, width));
			return [
				border(`┌${"─".repeat(innerWidth)}┐`),
				...inputLines.map((line) => `${border("│")}${this.pad(line, innerWidth)}${border("│")}`),
				border(`└${"─".repeat(innerWidth)}┘`),
			];
		}

		const renderLine = (line: string) => this.bg(style.inputBackgroundColor, this.pad(line, width));
		const inputRows = inputLines.map(renderLine);
		if (inputFrame === "solid") {
			const bottomPadding = this.bg(style.inputBackgroundColor, " ".repeat(Math.max(1, width)));
			return [...inputRows, bottomPadding];
		}

		const topPadding = this.styleBackgroundAsFg(style.inputBackgroundColor, "▄".repeat(Math.max(1, width)));
		const bottomPadding = this.styleBackgroundAsFg(style.inputBackgroundColor, "▀".repeat(Math.max(1, width)));
		return [topPadding, ...inputRows, bottomPadding];
	}

	private formatDroidCliModelBadge(): { plain: string; rendered: string } | null {
		const info = this.getModelInfo?.();
		const displayName = String(info?.name || info?.id || "").trim();
		if (!displayName) return null;
		const level = info?.reasoning && typeof info?.thinkingLevel === "string" && info.thinkingLevel.trim().length > 0
			? info.thinkingLevel.trim()
			: "";
		const levelLabel = level ? ` - ${level}` : "";
		return {
			plain: `${displayName}${levelLabel}`,
			rendered: `${this.tone("accent", displayName)}${levelLabel ? this.tone("muted", levelLabel) : ""}`,
		};
	}

	private formatDroidCliFooterStatus(): { plain: string; rendered: string } | null {
		const plain = normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
		if (!plain) return null;
		const rendered = plain.split(/(✓)/g).map((part) => part === "✓" ? this.tone("success", part) : this.tone("muted", part)).join("");
		return { plain, rendered };
	}

	private formatDroidCliProjectName(): string {
		const normalized = (this.sessionCwd || process.cwd()).replace(/\\/g, "/").replace(/\/+$/, "");
		return normalized.split("/").filter(Boolean).pop() || ".";
	}

	private renderDroidCliStatusLine(width: number): string {
		const parts: Array<{ plain: string; rendered: string }> = [];
		const model = this.formatDroidCliModelBadge();
		if (model) {
			parts.push({
				plain: `Model: ${model.plain}`,
				rendered: `${this.tone("accent", "Model:")} ${model.rendered}`,
			});
		}

		const usage = this.contextUsage();
		if (usage?.contextWindow) {
			const used = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? usage.tokens : 0;
			const ctxPlain = `Ctx: ${this.formatCompactTokens(used)}/${this.formatCompactTokens(usage.contextWindow)}`;
			parts.push({ plain: ctxPlain, rendered: this.tone("warning", ctxPlain) });
		}

		const branch = this.getBranch?.();
		if (branch?.branch) {
			parts.push({ plain: `🌿 ${branch.branch}`, rendered: this.tone("success", `🌿 ${branch.branch}`) });
		}

		const project = this.formatDroidCliProjectName();
		parts.push({ plain: `📁 ${project}`, rendered: this.tone("mdLinkUrl", `📁 ${project}`) });

		const separator = ` ${this.tone("dim", "|")} `;
		const rendered = parts.map((part) => part.rendered).join(separator);
		const status = this.formatDroidCliFooterStatus();
		if (!status) return safeVisibleWidth(rendered) > width ? safeTruncateToWidth(rendered, width, "…") : this.pad(rendered, width);
		return this.renderSplitRow(rendered, status.rendered, status.plain, width);
	}

	private renderGeminiFooter(width: number, contentWidth: number): string[] {
		const style = this.userZoneStyle.editor;
		const footerStatus = this.metadataInSidebar() ? "" : normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
		const items = [
			{ value: this.formatCwd(), weight: 2 },
			{ value: footerStatus, weight: 1 },
		].filter((item) => item.value.length > 0);
		if (items.length === 0) return [];

		const gap = "   ";
		const gapWidth = safeVisibleWidth(gap);
		const available = Math.max(1, contentWidth - gapWidth * (items.length - 1));
		const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
		let remaining = available;
		const widths = items.map((item, index) => {
			const last = index === items.length - 1;
			const columnWidth = last ? remaining : Math.max(1, Math.floor((available * item.weight) / totalWeight));
			remaining -= columnWidth;
			return columnWidth;
		});
		const wrappedColumns = items.map((item, index) => {
			const columnWidth = widths[index] ?? 1;
			const wrapped = safeWrapTextWithAnsi(item.value, columnWidth);
			return wrapped.length > 0 ? wrapped : [""];
		});
		const rowCount = Math.max(...wrappedColumns.map((column) => column.length));
		const rows: string[] = [];
		for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
			const parts = wrappedColumns.map((column, columnIndex) => {
				const value = column[rowIndex] ?? "";
				const colored = value ? this.tone(style.footerValueColor, value) : "";
				const columnWidth = widths[columnIndex] ?? 1;
				return columnIndex === wrappedColumns.length - 1 && wrappedColumns.length > 1
					? this.padLeft(colored, columnWidth)
					: this.pad(colored, columnWidth);
			});
			rows.push(this.renderPanelLine(parts.join(gap), width));
		}
		return rows;
	}

	private appendAutocomplete(lines: string[], autocompleteLines: string[], width: number): string[] {
		const slashBorderColor = this.themeExtraColor("inputBorderColor", this.userZoneStyle.editor.slashBorderColor);
		const customSlashAutocomplete = this.renderSlashAutocomplete(width, (value) => this.styleFg(slashBorderColor, value));
		if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];
		const paddedAutocomplete = autocompleteLines.map((line) => `${line}${" ".repeat(Math.max(0, width - safeVisibleWidth(line)))}`);
		return [...lines, ...paddedAutocomplete];
	}

	private renderDroidLayout(inputLines: string[], autocompleteLines: string[], width: number, contentInnerWidth: number): string[] {
		const editorStyle = this.userZoneStyle.editor;
		const lines: string[] = [];
		if (editorStyle.showHostBorder) lines.push(this.renderTopBorder(width));
		if (editorStyle.showMetadataRow) lines.push(this.renderPanelLine(this.renderTopRow(contentInnerWidth), width));
		if (editorStyle.showRuntimeRow) lines.push(this.renderPanelLine(this.renderRuntimeRow(contentInnerWidth), width));
		if (editorStyle.showDivider) lines.push(this.renderDivider(width));
		lines.push(...this.renderInputBoxFrame(inputLines, width));
		if (editorStyle.showTrailingBlankLine) lines.push(this.renderPanelLine("", width));
		return this.appendAutocomplete(lines, autocompleteLines, width);
	}

	private renderGeminiLayout(inputLines: string[], autocompleteLines: string[], width: number, contentInnerWidth: number): string[] {
		const lines: string[] = [];
		if (this.userZoneStyle.editor.showDivider) lines.push(this.renderGeminiDivider(width));
		if (this.userZoneStyle.editor.showRuntimeRow) lines.push(this.renderPanelLine(this.renderGeminiStatusRow(contentInnerWidth), width));
		lines.push(...this.renderInputBoxFrame(inputLines, width));
		lines.push(...this.renderGeminiFooter(width, contentInnerWidth));
		return this.appendAutocomplete(lines, autocompleteLines, width);
	}

	private renderDroidCliLayout(inputLines: string[], autocompleteLines: string[], width: number, contentInnerWidth: number): string[] {
		const lines: string[] = [];
		lines.push(...this.renderInputBoxFrame(inputLines, contentInnerWidth).map((line) => this.renderPanelLine(line, width)));
		lines.push(this.renderPanelLine(this.renderDroidCliStatusLine(contentInnerWidth), width));
		return this.appendAutocomplete(lines, autocompleteLines, width);
	}

	render(width: number): string[] {
		const editorStyle = this.userZoneStyle.editor;
		const contentInnerWidth = this.panelContentWidth(width);
		const text = this.getText();
		const promptColor = editorStyle.layout === "droid-cli"
			? editorStyle.promptColor
			: this.themeExtraColor("bashPromptColor", editorStyle.promptColor);
		const promptText = this.styleFg(promptColor, editorStyle.prompt);
		const prompt = editorStyle.promptBold ? this.bold(promptText) : promptText;
		const promptPrefix = `${prompt}${" ".repeat(Math.max(0, editorStyle.promptGap))}`;
		const prefixWidth = safeVisibleWidth(promptPrefix);
		const inputInnerWidth = Math.max(1, contentInnerWidth - (editorStyle.layout === "droid-cli" ? 2 : 0));
		const contentWidth = Math.max(1, inputInnerWidth - prefixWidth);
		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];
		const displayLines = this.renderInputContentLines(text, contentWidth);
		if (editorStyle.layout === "droid-cli" && text.length === 0 && displayLines[0] !== undefined) {
			const placeholder = this.tone("dim", " Type a prompt or / for commands");
			const available = Math.max(0, contentWidth - safeVisibleWidth(displayLines[0]));
			displayLines[0] = `${displayLines[0]}${safeVisibleWidth(placeholder) > available ? safeTruncateToWidth(placeholder, available, "") : placeholder}`;
		}

		const inputLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const available = Math.max(1, inputInnerWidth - safeVisibleWidth(prefix));
			const row = `${prefix}${this.pad(line, available)}`;
			return editorStyle.layout === "droid-cli" ? this.pad(row, inputInnerWidth) : this.renderPanelLine(row, width);
		});

		if (editorStyle.layout === "droid-cli") return this.renderDroidCliLayout(inputLines, autocompleteLines, width, contentInnerWidth);
		return editorStyle.layout === "gemini"
			? this.renderGeminiLayout(inputLines, autocompleteLines, width, contentInnerWidth)
			: this.renderDroidLayout(inputLines, autocompleteLines, width, contentInnerWidth);
	}
}
