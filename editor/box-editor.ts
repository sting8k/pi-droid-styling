import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { homedir, hostname, userInfo } from "node:os";

import { fgHex, stripAnsi } from "../ansi.js";
import { getThemeExtra } from "../theme-extras.js";

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
	reasoning?: boolean;
	thinkingLevel?: string;
} | undefined;

type BranchInfo = {
	branch: string;
	insertions?: number;
	deletions?: number;
};

type BranchProvider = () => BranchInfo | null;
type ResponseSpeedProvider = () => number | null;
type FooterStatusProvider = () => string | null;

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

const PANEL_PADDING_X = 2;

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
	) {
		super(tui, theme, kb);
	}

	private color(hex: string, text: string): string {
		return this.fullTheme ? fgHex(this.fullTheme, hex, text) : text;
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
		const prefixWidth = visibleWidth(prefix);

		if (description && width > 40) {
			const maxCommandWidth = Math.min(30, Math.max(8, width - prefixWidth - 10));
			const commandText = truncateToWidth(command, maxCommandWidth, "");
			const spacing = " ".repeat(Math.max(1, 32 - visibleWidth(commandText)));
			const remaining = width - prefixWidth - visibleWidth(commandText) - visibleWidth(spacing);

			if (remaining > 8) {
				const descriptionText = truncateToWidth(description, remaining, "");
				if (isSelected) {
					return this.color(getThemeExtra(this.fullTheme, "slashSelectedColor"), `${prefix}${commandText}${spacing}${descriptionText}`);
				}
				const commandColored = this.color(getThemeExtra(this.fullTheme, "slashCommandColor"), commandText);
				const descriptionColored = this.color(getThemeExtra(this.fullTheme, "slashDescriptionColor"), `${spacing}${descriptionText}`);
				return `${prefix}${commandColored}${descriptionColored}`;
			}
		}

		const commandOnly = truncateToWidth(command, Math.max(1, width - prefixWidth), "");
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
			const paddedNoMatch = `${noMatch}${" ".repeat(Math.max(0, innerWidth - visibleWidth(noMatch)))}`;
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
				const paddedRow = `${row}${" ".repeat(Math.max(0, innerWidth - visibleWidth(row)))}`;
				lines.push(`${border("│")}${paddedRow}${border("│")}`);
			}
		}
		lines.push(border(`└${"─".repeat(innerWidth)}┘`));

		const shownStart = visibleItems.length > 0 ? startIndex + 1 : 0;
		const shownEnd = startIndex + visibleItems.length;
		const hint = ` Use ↑↓ to navigate, Tab/Enter to select, Esc to cancel  Showing ${shownStart}-${shownEnd} of ${totalItems}`;
		const coloredHint = this.color(getThemeExtra(this.fullTheme, "slashHintColor"), hint);
		const truncatedHint = visibleWidth(coloredHint) > width ? truncateToWidth(coloredHint, width, "") : coloredHint;
		lines.push(`${truncatedHint}${" ".repeat(Math.max(0, width - visibleWidth(truncatedHint)))}`);

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
		const truncated = visibleWidth(content) > width ? truncateToWidth(content, width, "") : content;
		return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
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
		const fillColor = percent >= 90 ? "error" : "accent";
		const full = filled > 0 ? this.tone(fillColor, "━".repeat(filled)) : "";
		const empty = filled < total ? this.tone("borderMuted", "━".repeat(total - filled)) : "";
		return `${full}${empty}`;
	}

	private formatTokenMeter(): string | null {
		const usage = this.contextUsage();
		if (!usage || usage.percent === null) return null;

		const tokenCount = typeof usage.tokens === "number" && Number.isFinite(usage.tokens)
			? this.formatCompactTokens(usage.tokens)
			: "";
		const usageText = `${usage.percent.toFixed(1)}%/${this.formatCompactTokens(usage.contextWindow)}`;
		const detail = tokenCount
			? `${this.tone("muted", tokenCount)} ${this.tone("bashMode", "●")} ${this.tone("muted", usageText)}`
			: this.tone("muted", usageText);
		return `${this.tone("dim", "Tokens:")}  ${this.formatTokenBar(usage.percent)} ${detail}`;
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
		const sidePadding = Math.min(PANEL_PADDING_X, Math.floor(Math.max(0, width - 1) / 2));
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
		const sidePadding = Math.min(PANEL_PADDING_X, Math.floor(Math.max(0, width - 1) / 2));
		const sidePad = " ".repeat(sidePadding);
		const contentWidth = Math.max(1, width - sidePadding * 2);
		return `${sidePad}${this.pad(content, contentWidth)}${sidePad}`;
	}

	private renderTopBorder(width: number): string {
		const prefix = this.tone("accent", `== [${currentUserHost()}] == `);
		const remaining = Math.max(0, width - visibleWidth(prefix));
		return `${prefix}${this.tone("border", "⋯".repeat(remaining))}`;
	}

	private renderBoldDivider(width: number): string {
		return this.bold(this.tone("border", "━".repeat(Math.max(1, width))));
	}

	private formatCellLabel(label: string): string {
		return ` ${this.pad(this.tone("accent", `[${label}]`), 7)} `;
	}

	private renderTopRow(width: number): string {
		const sep = this.tone("borderMuted", "│");
		const model = this.formatModelBadge();
		const path = `${this.formatCellLabel("env")}${this.tone("accent", this.formatCwd())}`;
		const leftParts = [path, model?.rendered].filter(Boolean);
		let left = leftParts.join(` ${sep} `);
		const branch = this.formatBranchBadge();
		const right = branch ? `${sep} ${branch.rendered}` : "";
		const rightPlainWidth = branch ? visibleWidth(`│ ${branch.plain}`) : 0;
		const available = Math.max(1, width - rightPlainWidth - (right ? 1 : 0));
		const trimmedMain = visibleWidth(left) > available ? truncateToWidth(left, available, "…") : left;
		const gap = right ? " ".repeat(Math.max(1, width - visibleWidth(trimmedMain) - rightPlainWidth)) : "";
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

			const wrapped = wrapTextWithAnsi(line, width);
			rendered.push(...(wrapped.length > 0 ? wrapped : [""]));
		}

		return rendered.length > 0 ? rendered : [`${this.focused ? CURSOR_MARKER : ""}\x1b[7m \x1b[27m`];
	}

	private renderRuntimeRow(width: number): string {
		const bullet = this.tone("bashMode", "●");
		const tokenMeter = this.formatTokenMeter();
		const speedBadge = this.formatResponseSpeedBadge();
		const usageParts = [
			tokenMeter,
			speedBadge ? `${bullet} ${this.tone("muted", speedBadge)}` : null,
		].filter(Boolean);
		const left = usageParts.length > 0 ? `${this.formatCellLabel("stat")}${usageParts.join("  ")}` : this.formatCellLabel("stat").trimEnd();
		const footerStatus = this.getFooterStatus?.() ?? "";
		const rightPlain = normalizeSingleLine(stripAnsi(footerStatus));
		if (!rightPlain) return this.pad(left, width);

		const right = this.tone("dim", rightPlain);
		const rightWidth = visibleWidth(rightPlain);
		const availableLeft = Math.max(1, width - rightWidth - 2);
		const trimmedLeft = visibleWidth(left) > availableLeft ? truncateToWidth(left, availableLeft, "…") : left;
		const gap = " ".repeat(Math.max(2, width - visibleWidth(trimmedLeft) - rightWidth));
		return this.pad(`${trimmedLeft}${gap}${right}`, width);
	}

	render(width: number): string[] {
		const contentInnerWidth = this.panelContentWidth(width);
		const text = this.getText();
		const prompt = this.bold(this.tone("accent", "❯"));
		const promptPrefix = `${prompt} `;
		const prefixWidth = visibleWidth(promptPrefix);
		const contentWidth = Math.max(1, contentInnerWidth - prefixWidth);
		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];
		const displayLines = this.renderInputContentLines(text, contentWidth);

		const inputLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const renderedLine = line;
			const available = Math.max(1, contentInnerWidth - visibleWidth(prefix));
			return this.renderPanelLine(`${prefix}${this.pad(renderedLine, available)}`, width);
		});

		const lines = [
			this.renderTopBorder(width),
			this.renderPanelLine(this.renderTopRow(contentInnerWidth), width),
			this.renderPanelLine(this.renderRuntimeRow(contentInnerWidth), width),
			this.renderBoldDivider(width),
			...inputLines,
			this.renderPanelLine("", width),
		];

		const customSlashAutocomplete = this.renderSlashAutocomplete(width, (value) => this.tone("border", value));
		if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];

		const paddedAutocomplete = autocompleteLines.map((line) => `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`);
		return [...lines, ...paddedAutocomplete];
	}
}
