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
		if (percent === null || !Number.isFinite(percent)) return "";

		const totalBlocks = 10;
		const filledBlocks = Math.max(0, Math.min(totalBlocks, Math.round((percent / 100) * totalBlocks)));
		const filledColor = percent >= 90 ? "error" : percent >= 70 ? "warning" : "bashMode";
		const filled = filledBlocks > 0 ? this.tone(filledColor, "■".repeat(filledBlocks)) : "";
		const empty = filledBlocks < totalBlocks ? this.tone("dim", "■".repeat(totalBlocks - filledBlocks)) : "";
		return `${filled}${empty}`;
	}

	private formatResponseSpeedBadge(): string | null {
		const speed = this.getResponseSpeed?.();
		if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
		const rounded = speed >= 100 ? Math.round(speed).toString() : speed.toFixed(1).replace(/\.0$/, "");
		return `${rounded} words/s`;
	}

	private formatContextBadge(): string | null {
		const speed = this.formatResponseSpeedBadge();
		const usage = this.getContextUsage?.();
		if (!usage || !usage.contextWindow) return speed ? this.tone("dim", speed) : null;

		const percentValue = typeof usage.percent === "number" && Number.isFinite(usage.percent)
			? usage.percent
			: typeof usage.tokens === "number" && usage.contextWindow > 0
				? (usage.tokens / usage.contextWindow) * 100
				: null;
		const used = usage.tokens === null ? "?" : this.formatCompactTokens(usage.tokens);
		const percent = percentValue === null ? "?" : `${percentValue.toFixed(1)}%`;
		const dots = this.formatContextDots(percentValue);
		const parts = [
			dots,
			this.tone("dim", used),
			this.tone("dim", "·"),
			this.tone("dim", `${percent}/${this.formatCompactTokens(usage.contextWindow)}`),
		].filter(Boolean);
		const context = parts.join(" ");
		return speed ? `${context} ${this.tone("dim", "·")} ${this.tone("dim", speed)}` : context;
	}

	private formatCompactTokens(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		if (count < 1000000) return `${Math.round(count / 1000)}k`;
		if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
		return `${Math.round(count / 1000000)}M`;
	}

	private formatModelBadge(): { plain: string; rendered: string } | null {
		const info = this.getModelInfo?.();
		if (!info || !info.id) return null;

		const providerPlain = info.provider ? `[${info.provider.toUpperCase()}] ` : "";
		const levelPlain = info.reasoning && info.thinkingLevel
			? info.thinkingLevel === "off" ? " (thinking off)" : ` (${info.thinkingLevel})`
			: "";
		const plain = `${providerPlain}${info.id}${levelPlain}`;
		const rendered = `${this.tone("dim", providerPlain)}${this.bold(this.tone("mdLinkUrl", `${info.id}${levelPlain}`))}`;
		return { plain, rendered };
	}

	private bold(text: string): string {
		return typeof this.fullTheme?.bold === "function" ? this.fullTheme.bold(text) : text;
	}

	private tone(color: string, text: string): string {
		try {
			return typeof this.fullTheme?.fg === "function" ? this.fullTheme.fg(color, text) : text;
		} catch {
			return text;
		}
	}

	private extraTone(extraKey: string, fallbackColor: string, text: string): string {
		const color = getThemeExtra(this.fullTheme, extraKey);
		if (color) {
			if (/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) return this.color(color, text);
			return this.tone(color, text);
		}
		return this.tone(fallbackColor, text);
	}

	private padToWidth(content: string, width: number): string {
		const truncated = visibleWidth(content) > width ? truncateToWidth(content, width, "") : content;
		return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
	}

	private renderStatusLine(width: number): string {
		const left = this.formatContextBadge() ?? "";
		const branch = this.getBranch?.()?.branch;
		const right = branch ? this.bold(this.tone("mdLinkUrl", `(${branch})`)) : "";
		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		const gap = Math.max(1, width - leftWidth - rightWidth - (left && right ? 2 : left || right ? 1 : 0));
		const rule = this.tone("borderMuted", "─".repeat(gap));
		if (left && right) return this.padToWidth(`${left} ${rule} ${right}`, width);
		if (left) return this.padToWidth(`${left} ${rule}`, width);
		if (right) return this.padToWidth(`${rule} ${right}`, width);
		return this.padToWidth(rule, width);
	}

	render(width: number): string[] {
		const text = this.getText();
		const isBashMode = text.startsWith("!");
		const promptChar = ">";
		const modelBadge = this.formatModelBadge();
		const prompt = this.bold(this.extraTone("inputBorderColor", "mdLink", promptChar));
		const promptPrefix = `${prompt} `;
		const modelWidth = modelBadge ? visibleWidth(modelBadge.plain) + 1 : 0;
		const prefixWidth = visibleWidth(promptPrefix);
		const contentWidth = Math.max(1, width - prefixWidth - modelWidth);

		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const rawContentLines = bottomBorderIndex > 0 ? parentLines.slice(1, bottomBorderIndex) : parentLines.slice(1);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];
		const displayLines = rawContentLines.length > 0 ? [...rawContentLines] : [""];
		if (isBashMode && displayLines[0]) displayLines[0] = stripBashPrefix(displayLines[0]);

		const inputLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const right = index === 0 && modelBadge ? modelBadge.rendered : "";
			const available = Math.max(1, width - visibleWidth(prefix) - (right ? visibleWidth(modelBadge!.plain) + 1 : 0));
			const content = this.padToWidth(line, available);
			return this.padToWidth(right ? `${prefix}${content} ${right}` : `${prefix}${content}`, width);
		});

		const lines = [
			this.renderStatusLine(width),
			...inputLines,
		];

		const border = (value: string) => this.tone("borderMuted", value);
		const customSlashAutocomplete = this.renderSlashAutocomplete(width, border);
		if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];

		const paddedAutocomplete = autocompleteLines.map((line) => this.padToWidth(line, width));
		return [...lines, ...paddedAutocomplete];
	}
}
