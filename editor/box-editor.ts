import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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

export class BoxEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		kb: any,
		private readonly fullTheme: any,
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

	private formatContextDots(percent: number | null): string {
		if (percent === null) return "";
		const total = 4;
		const filled = Math.max(0, Math.min(total, Math.round((percent / 100) * total)));
		return "◼".repeat(filled) + "◻".repeat(total - filled);
	}

	private formatResponseSpeedBadge(): string | null {
		const speed = this.getResponseSpeed?.();
		if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
		const rounded = speed >= 100 ? Math.round(speed).toString() : speed.toFixed(1).replace(/\.0$/, "");
		return `${rounded} toks/s`;
	}

	private formatContextBadge(): string | null {
		const speed = this.formatResponseSpeedBadge();
		const usage = this.getContextUsage?.();
		if (!usage || !usage.contextWindow) return speed;
		const used = usage.tokens === null ? "?" : this.formatCompactTokens(usage.tokens);
		const percent = usage.percent === null ? "?" : `${usage.percent.toFixed(1)}%`;
		const dots = this.formatContextDots(usage.percent);
		const context = dots
			? `${dots} ${used} · ${percent}/${this.formatCompactTokens(usage.contextWindow)}`
			: `${used} · ${percent}/${this.formatCompactTokens(usage.contextWindow)}`;
		return speed ? `${context} · ${speed}` : context;
	}

	private formatCompactTokens(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		if (count < 1000000) return `${Math.round(count / 1000)}k`;
		if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
		return `${Math.round(count / 1000000)}M`;
	}

	private formatModelBadge(): string | null {
		const info = this.getModelInfo?.();
		if (!info || !info.id) return null;
		let badge = info.provider ? `[${info.provider}] ${info.id}` : info.id;
		if (info.reasoning && info.thinkingLevel) {
			badge += info.thinkingLevel === "off" ? " (thinking off)" : ` (${info.thinkingLevel})`;
		}
		return badge;
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const border = this.fullTheme
			? (text: string) => fgHex(this.fullTheme, getThemeExtra(this.fullTheme, "inputBorderColor"), text)
			: this.borderColor;

		const text = this.getText();
		const isBashMode = text.startsWith("!");
		const isDoubleBang = text.startsWith("!!");

		const promptChar = isDoubleBang ? "!!" : isBashMode ? "!" : ">";
		const prompt = this.fullTheme
			? isBashMode
				? fgHex(this.fullTheme, getThemeExtra(this.fullTheme, "bashPromptColor"), promptChar)
				: this.fullTheme.fg("accent", ">")
			: promptChar;
		const promptPrefix = ` ${prompt} `;
		const prefixWidth = visibleWidth(promptPrefix);
		const contentWidth = Math.max(1, innerWidth - prefixWidth);

		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const rawContentLines =
			bottomBorderIndex > 0 ? parentLines.slice(1, bottomBorderIndex) : parentLines.slice(1);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];

		const displayLines = rawContentLines.length > 0 ? [...rawContentLines] : [""];
		if (isBashMode && displayLines[0]) {
			displayLines[0] = stripBashPrefix(displayLines[0]);
		}

		const boxedLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const lineWidth = visibleWidth(line);
			const padding = " ".repeat(Math.max(0, contentWidth - lineWidth));
			return `${border("│")}${prefix}${line}${padding}${border("│")}`;
		});

		const contextBadge = this.formatContextBadge();
		const branchInfo = this.getBranch?.();
		const leftSegment = contextBadge ? ` ${contextBadge} ` : "";
		let rightSegment = "";
		let rightRendered = "";
		if (branchInfo) {
			let diffPlain = "";
			let diffColored = "";
			if (branchInfo.insertions || branchInfo.deletions) {
				const insPlain = branchInfo.insertions ? `+${branchInfo.insertions}` : "";
				const delPlain = branchInfo.deletions ? `-${branchInfo.deletions}` : "";
				diffPlain = [insPlain, delPlain].filter(Boolean).join(" ");
				const insColored = branchInfo.insertions ? this.color(getThemeExtra(this.fullTheme, "gitInsertionColor"), insPlain) : "";
				const delColored = branchInfo.deletions ? this.color(getThemeExtra(this.fullTheme, "gitDeletionColor"), delPlain) : "";
				diffColored = [insColored, delColored].filter(Boolean).join(" ");
			}
			rightSegment = diffPlain ? ` (${branchInfo.branch}) ${diffPlain} ` : ` (${branchInfo.branch}) `;
			rightRendered = diffColored ? `${border(` (${branchInfo.branch}) `)}${diffColored}${border(" ")}` : border(rightSegment);
		}
		const leftWidth = visibleWidth(leftSegment);
		const rightWidth = visibleWidth(rightSegment);
		const fillWidth = innerWidth - leftWidth - rightWidth;
		const topBorder =
			fillWidth >= 1
				? `${border("┌")}${leftSegment ? border(leftSegment) : ""}${border("─".repeat(fillWidth))}${rightRendered || ""}${border("┐")}`
				: border(`┌${"─".repeat(innerWidth)}┐`);
		const bottomBorder = (() => {
			const modelBadge = this.formatModelBadge();
			if (modelBadge) {
				const seg = ` ${modelBadge} `;
				const segWidth = visibleWidth(seg);
				if (segWidth < innerWidth) {
					return `${border("└")}${border("─".repeat(innerWidth - segWidth))}${border(seg)}${border("┘")}`;
				}
			}
			return border(`└${"─".repeat(innerWidth)}┘`);
		})();

		const customSlashAutocomplete = this.renderSlashAutocomplete(width, border);
		if (customSlashAutocomplete) {
			return [topBorder, ...boxedLines, bottomBorder, ...customSlashAutocomplete];
		}

		const paddedAutocomplete = autocompleteLines.map((line) => {
			const padding = " ".repeat(Math.max(0, width - visibleWidth(line)));
			return `${line}${padding}`;
		});

		return [topBorder, ...boxedLines, bottomBorder, ...paddedAutocomplete];
	}
}
