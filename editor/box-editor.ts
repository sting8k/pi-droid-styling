import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { homedir } from "node:os";

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

function stripBashPrefix(line: string): string {
	if (line.startsWith("!!")) return line.slice(2);
	if (line.startsWith("!")) return line.slice(1);
	return line;
}

function normalizeSingleLine(text: string): string {
	return text.replace(/[\r\n]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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

		lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
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
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

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
		const fillColor = percent >= 90 ? "error" : "syntaxOperator";
		const full = filled > 0 ? this.tone(fillColor, "━".repeat(filled)) : "";
		const empty = filled < total ? this.tone("borderMuted", "━".repeat(total - filled)) : "";
		return `${full}${empty}`;
	}

	private formatTokenMeter(): string | null {
		const usage = this.contextUsage();
		if (!usage || usage.percent === null) return null;
		return `${this.tone("dim", "Tokens:")} ${this.formatTokenBar(usage.percent)} ${this.tone("muted", `${usage.percent.toFixed(1)}%`)}`;
	}

	private formatResponseSpeedBadge(): string | null {
		const speed = this.getResponseSpeed?.();
		if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
		const rounded = speed >= 100 ? Math.round(speed).toString() : speed.toFixed(1).replace(/\.0$/, "");
		return `${rounded} words/s`;
	}

	private formatContextMetric(): string | null {
		const usage = this.contextUsage();
		if (!usage || usage.percent === null) return null;
		return `${usage.percent.toFixed(1)}%/${this.formatCompactTokens(usage.contextWindow)}`;
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
		return `${parts[0]} …/${parts.slice(-1)[0]}`;
	}

	private panelContentWidth(width: number): number {
		const innerWidth = Math.max(1, width - 2);
		const sidePadding = Math.min(PANEL_PADDING_X, Math.floor(Math.max(0, innerWidth - 1) / 2));
		return Math.max(1, innerWidth - sidePadding * 2);
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
			this.bold(this.tone("bashMode", info.branch)),
			renderedDiff,
		].filter(Boolean).join(" ");
		return { plain, rendered };
	}

	private renderPanelLine(content: string, width: number, border: (text: string) => string): string {
		const innerWidth = Math.max(1, width - 2);
		const sidePadding = Math.min(PANEL_PADDING_X, Math.floor(Math.max(0, innerWidth - 1) / 2));
		const sidePad = " ".repeat(sidePadding);
		const contentWidth = Math.max(1, innerWidth - sidePadding * 2);
		return `${border("│")}${sidePad}${this.pad(content, contentWidth)}${sidePad}${border("│")}`;
	}

	private renderTopRow(width: number): string {
		const sep = this.tone("borderMuted", "│");
		const model = this.formatModelBadge();
		const leftParts = [this.tone("syntaxOperator", this.formatCwd()), model?.rendered].filter(Boolean);
		let left = leftParts.join(` ${sep} `);
		const tokenMeter = this.formatTokenMeter() ?? "";
		const branch = this.formatBranchBadge();
		const right = branch ? `${sep} ${branch.rendered}` : "";
		const rightPlainWidth = branch ? visibleWidth(`│ ${branch.plain}`) : 0;
		const available = Math.max(1, width - rightPlainWidth - (right ? 1 : 0));
		const main = tokenMeter ? `${left}  ${tokenMeter}` : left;
		const trimmedMain = visibleWidth(main) > available ? truncateToWidth(main, available, "…") : main;
		const gap = right ? " ".repeat(Math.max(1, width - visibleWidth(trimmedMain) - rightPlainWidth)) : "";
		return this.pad(`${trimmedMain}${gap}${right}`, width);
	}

	private renderRuntimeRow(width: number): string {
		const bullet = this.tone("bashMode", "●");
		const metrics = [
			this.formatContextMetric(),
			this.formatResponseSpeedBadge(),
		].filter(Boolean).map((item) => `${bullet} ${this.tone("muted", item!)}`);
		return this.pad(metrics.join("  "), width);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const contentInnerWidth = this.panelContentWidth(width);
		const border = (text: string) => this.tone("borderMuted", text);

		const text = this.getText();
		const isBashMode = text.startsWith("!");
		const prompt = this.bold(this.tone("syntaxOperator", "❯"));
		const promptPrefix = `${prompt} `;
		const prefixWidth = visibleWidth(promptPrefix);
		const contentWidth = Math.max(1, contentInnerWidth - prefixWidth);
		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const rawContentLines = bottomBorderIndex > 0 ? parentLines.slice(1, bottomBorderIndex) : parentLines.slice(1);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];

		const displayLines = rawContentLines.length > 0 ? [...rawContentLines] : [""];
		if (isBashMode && displayLines[0]) displayLines[0] = stripBashPrefix(displayLines[0]);

		const inputLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const renderedLine = index === 0 && stripAnsi(line).trim().length === 0 ? this.tone("syntaxOperator", "█") : line;
			const available = Math.max(1, contentInnerWidth - visibleWidth(prefix));
			return this.renderPanelLine(`${prefix}${this.pad(renderedLine, available)}`, width, border);
		});

		const separator = border(`├${"─".repeat(innerWidth)}┤`);
		const lines = [
			border(`╭${"─".repeat(innerWidth)}╮`),
			this.renderPanelLine(this.renderTopRow(contentInnerWidth), width, border),
			separator,
			this.renderPanelLine(this.renderRuntimeRow(contentInnerWidth), width, border),
			separator,
			...inputLines,
			border(`╰${"─".repeat(innerWidth)}╯`),
		];

		const customSlashAutocomplete = this.renderSlashAutocomplete(width, border);
		if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];

		const paddedAutocomplete = autocompleteLines.map((line) => `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`);
		return [...lines, ...paddedAutocomplete];
	}
}
