import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { homedir, hostname, userInfo } from "node:os";

import { safeWrapTextWithAnsi, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { fgHex, stripAnsi } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";
import { resolveUserZoneStyle, type UserZoneStyle } from "../user-zone/designs.js";
import type { InputBoxStyle } from "../config.js";

/** Outline border plus the prompt gap, so the cli-dock status row lines up with the input text. */
const CLI_DOCK_STATUS_INSET = 2;

// Minimum visible width recomposeNvimLeft guarantees the model id (never the provider, which is
// sacrificed first) once the left cluster is actually being truncated.
const NVIM_MIN_MODEL_WIDTH = 8;

// Display cap for the model id, applied at SOURCE (before any rung/recompose sees it): every branch
// renders the same capped id. Real-world ids top out at ~36 columns (anthropic/claude-3.5-sonnet-20241022
// = 35), so 40 always shows a real id in full; it exists only so a pathological 100+ column id cannot
// budget the status or chrome off its own untruncated width. This is a DISPLAY cap, not a scoring cap:
// the allocator consumes the left cluster's actual width, which this cap keeps bounded by construction.
const NVIM_MODEL_ID_MAX = 40;

// Display cap for the branch NAME in the nvim input-frame top-rule label (US-023), applied at source
// like NVIM_MODEL_ID_MAX. The [+N][-M] LOC tail is never truncated -- split integers are meaningless;
// when the tail does not fit, the label degrades to the name-only rung first (churn yields to
// identity), then to a plain rule. 24 keeps `feature/...` slugs readable while leaving the label
// comfortably inside typical terminal widths alongside the model cluster.
const NVIM_BRANCH_MAX = 24;

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
type FooterTokenUsageProvider = () => string | null;

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
		private readonly editorTheme: any,
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
		private readonly inputBoxStyle?: InputBoxStyle,
		private readonly getFooterTokenUsage?: FooterTokenUsageProvider,
	) {
		super(tui, editorTheme, kb);
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
		return this.buildBranchBadge(info.branch, info.insertions, info.deletions, true);
	}

	// Single source of the `⎇ branch [+N] [-M]` FORMAT (token order, spaces, brackets), shared by the
	// existing non-nvim branch-badge call sites (droid's renderTopRow and gemini's status row --
	// cli-dock renders no branch) and the nvim input-frame top-rule label (US-023).
	// Colour is CALLER-decided: each `tones` entry is a theme tone NAME, a custom colorizer FUNCTION
	// (the nvim rule passes the rule's own colorizer so ⎇ and the name melt into the rule), or `null`
	// for terminal-default fg. Omitting `tones` keeps the historic footer styling byte-identical.
	// `withDiff: false` drops the LOC tail -- the nvim label's middle degrade rung, where churn yields
	// to identity; zero insertions/deletions self-hide.
	private buildBranchBadge(
		branch: string,
		insertions: number | undefined,
		deletions: number | undefined,
		withDiff: boolean,
		tones?: { icon: string | ((text: string) => string) | null; name: string | ((text: string) => string) | null; ins: string | null; del: string | null },
		style: "brackets" | "bare" = "brackets",
	): { plain: string; rendered: string } | null {
		if (!branch) return null;
		const toneMap = tones ?? { icon: "bashMode", name: "mdLinkUrl", ins: "success", del: "error" };
		const seg = (tone: string | ((text: string) => string) | null, text: string) => {
			if (typeof tone === "function") return tone(text);
			return tone ? this.tone(tone, text) : text;
		};
		const insText = style === "bare" ? `+${insertions}` : `[+${insertions}]`;
		const delText = style === "bare" ? `-${deletions}` : `[-${deletions}]`;
		const icon = "⎇";
		const diffPlain = withDiff
			? [
				insertions ? insText : "",
				deletions ? delText : "",
			  ].filter(Boolean)
			: [];
		const plain = [icon, branch, ...diffPlain].join(" ");
		const renderedDiff = withDiff
			? [
				insertions ? seg(toneMap.ins, insText) : "",
				deletions ? seg(toneMap.del, delText) : "",
			  ].filter(Boolean).join(" ")
			: "";
		const rendered = [
			seg(toneMap.icon, icon),
			seg(toneMap.name, branch),
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

	private formatFooterTokenUsage(): string {
		return normalizeSingleLine(stripAnsi(this.getFooterTokenUsage?.() ?? ""));
	}

	private renderRuntimeRow(width: number): string {
		const usageParts = this.formatRuntimeParts();
		const left = usageParts.length > 0 ? `${this.formatCellLabel("stat")}${usageParts.join("  ")}` : this.formatCellLabel("stat").trimEnd();
		const footerStatus = this.metadataInSidebar() ? "" : (this.getFooterStatus?.() ?? "");
		const tokenUsage = this.formatFooterTokenUsage();
		const rightPlain = [tokenUsage, normalizeSingleLine(stripAnsi(footerStatus))].filter(Boolean).join("  ");
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

		if (this.userZoneStyle.name === "cli-dock") return "outline";
		if (frame === "line" && this.userZoneStyle.name === "droid") return "none";
		if (frame === "line" || frame === "halfblock" || frame === "none" || frame === "solid" || frame === "outline") return frame;
		return process.env.NO_COLOR ? "line" : "halfblock";
	}

	// The colorizer the nvim `line` frame's rule runs use -- ONE source for the rule segments AND the
	// US-023 top-rule label, so the label's ⎇ and branch name always melt into the rule's exact tone
	// (user round-3: plain default-fg outshone the rule; the label must share the rule's colour, never
	// a guessed token). Exposed as a closure so the branch-badge formatter can consume it verbatim.
	private inputRuleColorizer(): (text: string) => string {
		const style = this.userZoneStyle.editor;
		return (text: string) => this.styleBackgroundAsFg(style.inputBackgroundColor, text);
	}

	private renderInputLineBorder(width: number, topLabel?: { plain: string; rendered: string } | null): string {
		const style = this.userZoneStyle.editor;
		const char = (style.dividerChar || "─") as string;
		const ruleFg = this.inputRuleColorizer();
		if (!topLabel) {
			return ruleFg(char.repeat(Math.max(1, width)));
		}
		// US-023 nvim top rule: rule xN + ' label ' + one trailing rule dash, total exactly `width`. The
		// rule keeps the frame colour; the label keeps the shared branch-badge formatter's colours, each
		// tone closed with its own \x1b[39m so no full reset ever leaks between the two colour regimes.
		const labelWidth = safeVisibleWidth(topLabel.plain);
		const leftCount = Math.max(2, width - labelWidth - 3);
		return `${ruleFg(char.repeat(leftCount))} ${topLabel.rendered} ${ruleFg(char.repeat(1))}`;
	}

	private renderInputBoxFrame(inputLines: string[], width: number, topLabel?: { plain: string; rendered: string } | null): string[] {
		const style = this.userZoneStyle.editor;
		const inputFrame = this.resolveInputFrame();
		if (inputFrame === "line") {
			const top = this.renderInputLineBorder(width, topLabel);
			const bottom = this.renderInputLineBorder(width);
			return [top, ...inputLines.map((line) => this.pad(line, width)), bottom];
		}
		if (inputFrame === "none") return inputLines;
		if (inputFrame === "outline") {
			const borderColor = this.userZoneStyle.name === "cli-dock"
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

	private formatCliDockModelBadge(): { plain: string; rendered: string } | null {
		const info = this.getModelInfo?.();
		const displayName = String(info?.name || info?.id || "").trim();
		if (!displayName) return null;
		const level = info?.reasoning && typeof info?.thinkingLevel === "string" && info.thinkingLevel.trim().length > 0
			? info.thinkingLevel.trim()
			: "";
		const levelLabel = level ? ` · ${level}` : "";
		return {
			plain: `${displayName}${levelLabel}`,
			rendered: `${this.tone("accent", displayName)}${level ? `${this.tone("muted", " · ")}${this.tone("accent", level)}` : ""}`,
		};
	}

	private formatCliDockFooterStatus(): { plain: string; rendered: string } | null {
		const plain = normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
		if (!plain) return null;
		const rendered = plain.split(/(✓)/g).map((part) => part === "✓" ? this.tone("success", part) : this.tone("muted", part)).join("");
		return { plain, rendered };
	}

	private formatCliDockProjectName(): string {
		const normalized = (this.sessionCwd || process.cwd()).replace(/\\/g, "/").replace(/\/+$/, "");
		return normalized.split("/").filter(Boolean).pop() || ".";
	}

	private renderCliDockStatusLine(width: number): string {
		const parts: Array<{ plain: string; rendered: string }> = [];
		const model = this.formatCliDockModelBadge();
		if (model) {
			parts.push({ plain: model.plain, rendered: model.rendered });
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

		const project = this.formatCliDockProjectName();
		parts.push({ plain: `📁 ${project}`, rendered: this.tone("mdLinkUrl", `📁 ${project}`) });

		const separator = ` ${this.tone("dim", "|")} `;
		const rendered = parts.map((part) => part.rendered).join(separator);
		const tokenUsage = this.formatFooterTokenUsage();
		const status = this.formatCliDockFooterStatus();
		const rightPlain = [tokenUsage, status?.plain].filter(Boolean).join("  ");
		if (!rightPlain) return safeVisibleWidth(rendered) > width ? safeTruncateToWidth(rendered, width, "…") : this.pad(rendered, width);
		const right = [tokenUsage ? this.tone("dim", tokenUsage) : null, status?.rendered].filter(Boolean).join(this.tone("dim", "  "));
		return this.renderSplitRow(rendered, right, rightPlain, width);
	}

	private renderGeminiFooter(width: number, contentWidth: number): string[] {
		const style = this.userZoneStyle.editor;
		const footerStatus = this.metadataInSidebar() ? "" : normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
		const tokenUsage = this.formatFooterTokenUsage();
		const affordance = [tokenUsage, footerStatus].filter(Boolean).join("  ");
		const cwd = this.formatCwd();
		if (!affordance && !cwd) return [];

		// Right cluster stays anchored to the right edge and grows leftward on a
		// single line; the cwd is truncated instead of wrapping the cluster into
		// a narrow column.
		// Reserve one column for the truncated cwd plus the minimum gap so the
		// cluster never gets clipped by the panel padding.
		const maxRightWidth = Math.max(1, contentWidth - 3);
		const rightPlain = safeVisibleWidth(affordance) > maxRightWidth
			? safeTruncateToWidth(affordance, maxRightWidth, "…")
			: affordance;
		const left = cwd ? this.tone(style.footerValueColor, cwd) : "";
		const right = rightPlain ? this.tone(style.footerValueColor, rightPlain) : "";
		return [this.renderPanelLine(this.renderSplitRow(left, right, rightPlain, contentWidth), width)];
	}

	private appendAutocomplete(lines: string[], autocompleteLines: string[], width: number): string[] {
		const slashBorderColor = this.themeExtraColor("inputBorderColor", this.userZoneStyle.editor.slashBorderColor);
		const customSlashAutocomplete = this.renderSlashAutocomplete(width, (value) => this.styleFg(slashBorderColor, value));
		if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];
		const paddedAutocomplete = autocompleteLines.map((line) => `${line}${" ".repeat(Math.max(0, width - safeVisibleWidth(line)))}`);
		return [...lines, ...paddedAutocomplete];
	}

	private probeThemeFn(name: string): ((...args: any[]) => any) | null {
		const editorTheme = this.editorTheme as any;
		if (typeof editorTheme?.[name] === "function") return editorTheme[name].bind(editorTheme);
		const fullTheme = this.fullTheme as any;
		if (typeof fullTheme?.[name] === "function") return fullTheme[name].bind(fullTheme);
		return null;
	}

	private colorizeNvimBashBadge(block: string): string {
		const getBashColor = this.probeThemeFn("getBashModeBorderColor");
		const colorize = getBashColor?.();
		return typeof colorize === "function" ? colorize(block) : block;
	}

	private formatNvimBadge(): { plain: string; rendered: string; rerender: (t: string) => string } | null {
		// Coloured by mode, not by thinking level: thinkingBorderColor tokens are tuned for a thin
		// border line and every theme keeps them deliberately desaturated, so filling them into a
		// solid block renders as a muddy slab. The level lives in the label text only.
		// `rerender` re-wraps an arbitrary (possibly truncated) block in the same reverse-video +
		// mode colour, so a narrow-width recompose can truncate the badge without losing its colour.
		const isBashMode = this.getText().trimStart().startsWith("!");
		const info = this.getModelInfo?.();
		if (!isBashMode && !(info?.reasoning && info.thinkingLevel)) return null;
		const label = isBashMode ? "BASH" : String(info!.thinkingLevel).toUpperCase();
		const block = ` ${label} `;
		const colored = isBashMode ? this.colorizeNvimBashBadge(block) : this.tone("accent", block);
		const rerender = (t: string) => `\x1b[7m${isBashMode ? this.colorizeNvimBashBadge(t) : this.tone("accent", t)}\x1b[27m`;
		return { plain: block, rendered: `\x1b[7m${colored}\x1b[27m`, rerender };
	}

	private formatNvimCacheHitPercent(): string {
		const raw = stripAnsi(this.getFooterTokenUsage?.() ?? "");
		const match = raw.match(/CH([\d.]+)%/);
		return match ? `${Math.round(Number(match[1]))}%` : "";
	}

	private renderNvimStatusline(width: number): string {
		const badge = this.formatNvimBadge();
		const badgePlain = badge?.plain ?? "";
		const badgeRendered = badge?.rendered ?? "";
		const info = this.getModelInfo?.();
		const provider = typeof info?.provider === "string" ? info.provider.trim().toLowerCase() : "";
		const modelId = typeof info?.id === "string" ? this.truncatePlain(info.id.trim(), NVIM_MODEL_ID_MAX, "\u2026") : "";

		// Breath gap: whenever the badge block and the model id are both rendered, exactly one space
		// sits OUTSIDE the reverse-video block, between its edge and the next character. The badge's
		// own trailing space lives INSIDE the coloured block, so without this column the model-only
		// rung reads as glued to the block. The gap is a real column of the left cluster -- counted by
		// the candidate scoring and kept ahead of the model id by recomposeNvimLeft -- never pasted on
		// after truncation, so it survives every width.
		const badgeGap = badge && modelId ? " " : "";

		const leftWithProviderPlain = modelId ? `${badgePlain}${badgeGap}${provider ? `${provider} · ${modelId}` : modelId}` : badgePlain;
		const leftWithProviderRendered = modelId
			? `${badgeRendered}${badgeGap}${provider ? `${this.tone("dim", provider)}${this.tone("dim", " · ")}` : ""}${this.tone("muted", modelId)}`
			: badgeRendered;
		const leftModelOnlyPlain = modelId ? `${badgePlain}${badgeGap}${modelId}` : badgePlain;
		const leftModelOnlyRendered = modelId ? `${badgeRendered}${badgeGap}${this.tone("muted", modelId)}` : badgeRendered;
		const usage = this.contextUsage();


		const ctxPercent = usage && typeof usage.percent === "number" && Number.isFinite(usage.percent) ? `${Math.round(usage.percent)}%` : "";
		const tokensPart = usage && typeof usage.tokens === "number" && Number.isFinite(usage.tokens)
			? `${this.formatCompactTokens(usage.tokens)}/${this.formatCompactTokens(usage.contextWindow)}`
			: "";
		const chPercent = this.formatNvimCacheHitPercent();
		const tokensCtx = [tokensPart, ctxPercent].filter(Boolean).join(" ");

		// US-023: the branch moved to the input-frame top rule (`⎇ name [+N][-M]`), so the right cluster is
		// tokens/ctx/CH only -- a value must never appear twice in the user zone. The freed columns flow
		// to the extension status through the same candidate scoring as before.
		const chromeFullPlain = [tokensCtx, chPercent ? `CH ${chPercent}` : ""].filter(Boolean).join(" · ");

		// Rung order pins the priority the user actually reads by: the context metric outranks the
		// provider (decoration, sacrificed FIRST), and within the metric CH% drops before the token
		// count. So the ladder degrades provider → CH% → tokens → ctx%, never the reverse.
		const candidates = [
			{ leftPlain: leftWithProviderPlain, left: leftWithProviderRendered, chromePlain: chromeFullPlain },
			{ leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: chromeFullPlain },
			{ leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: tokensCtx },
			{ leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: ctxPercent },
			{ leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: "" },
		];

		// Choose the (left variant + chrome rung) that shows the MOST status, keeping the higher-priority
		// ladder rung on a tie. A rung only competes if its OWN chrome fits `avail`, computed from the
		// candidate's ACTUAL left width. That stayed a problem for 150+ column model ids until the id was
		// capped at source (NVIM_MODEL_ID_MAX above): the left cluster's actual width is now bounded by
		// construction, so no scoring-side clamp is needed and this is again a single formula per candidate.
		// The earlier two-formula attempt (cap in scoring vs cap at source) is history: two formulas that
		// differ by a constant offset, switched between on a width-dependent condition, always create a
		// discontinuity at the switch boundary (it made a chrome element appear, disappear, reappear --
		// reproduced and root-caused before the revert). Width-monotonicity of every channel is now pinned
		// by the smoke suite's Properties 2/3/4.
		const status = normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
		let chosen = candidates[candidates.length - 1]!;
		let statusShown = "";
		let bestWidth = -1;
		for (const c of candidates) {
			const avail = Math.max(0, width - safeVisibleWidth(c.leftPlain) - 2);
			const chromeW = safeVisibleWidth(c.chromePlain);
			if (chromeW > avail) continue;
			const budget = avail - chromeW - (c.chromePlain ? 2 : 0);
			const candidateShown = this.reserveNvimStatus(status, budget);
			const candidateWidth = safeVisibleWidth(candidateShown);
			if (candidateWidth > bestWidth) {
				bestWidth = candidateWidth;
				chosen = c;
				statusShown = candidateShown;
			}
		}
		const rightPlain = [chosen.chromePlain, statusShown].filter(Boolean).join("  ");
		const rightWidth = safeVisibleWidth(rightPlain);
		const leftMax = Math.max(0, width - rightWidth - (rightPlain ? 2 : 0));

		// The left cluster can overflow when an over-long (or missing) model id, or a narrow terminal,
		// pushes even the model-only candidate past the bar. Truncate THAT on the plain string and
		// re-colour per segment, so the coloured left is never handed to a width-based truncator.
		let leftPlain = chosen.leftPlain;
		let leftRendered = chosen.left;
		if (safeVisibleWidth(leftPlain) > leftMax) {
			const withProvider = Boolean(modelId) && chosen.leftPlain === leftWithProviderPlain;
			const rec = this.recomposeNvimLeft(badgePlain, badge?.rerender, provider, modelId, badgeGap, withProvider, leftMax);
			leftPlain = rec.plain;
			leftRendered = rec.render;
		}

		// Assemble on plain widths and colour last; the final row is never truncated, so no full
		// \x1b[0m reset can appear anywhere in the bar at any width, model length, or status.
		// The context metric is muted (the same tier as the model id — it is a value the user reads
		// constantly, not decoration); the extension status stays dim.
		const chromeRendered = chosen.chromePlain ? this.tone("muted", chosen.chromePlain) : "";
		const statusRendered = statusShown ? this.tone("dim", statusShown) : "";
		const right = [chromeRendered, statusRendered].filter(Boolean).join("  ");
		const middle = rightPlain ? Math.max(2, width - safeVisibleWidth(leftPlain) - rightWidth) : 0;
		const rowBody = `${leftRendered}${" ".repeat(middle)}${right}`;
		const row = `${rowBody}${" ".repeat(Math.max(0, width - safeVisibleWidth(rowBody)))}`;
		return this.bg(this.userZoneStyle.editor.inputBackgroundColor, row);
	}

	// Width-based truncation of a PLAIN string is not guaranteed to return plain output: pi-tui's
	// truncateToWidth (the fallback safeTruncateToWidth uses for anything outside the fast ASCII path --
	// CJK, emoji, any multi-byte grapheme) always wraps its ellipsis in \x1b[0m, even for plain input with
	// no ANSI at all. That contract is undocumented, so probe-and-strip rather than trust the name: the
	// input here is always plain, so every escape the truncator emits is junk it invented, and because an
	// escape has zero visible width, stripping it cannot change the width the truncator computed.
	private truncatePlain(text: string, maxWidth: number, ellipsis = "…"): string {
		return stripAnsi(safeTruncateToWidth(text, maxWidth, ellipsis));
	}

	// Reserve room for the extension status: the full string if it fits, a truncated-but-legible prefix
	// if only that fits, or nothing at all -- a lone ellipsis is worse than no status, since it carries
	// zero information and reads like a render error.
	private reserveNvimStatus(status: string, budget: number): string {
		if (!status || budget <= 0) return "";
		if (safeVisibleWidth(status) <= budget) return status;
		const truncated = this.truncatePlain(status, budget, "…");
		return truncated === "…" ? "" : truncated;
	}

	// Re-colour a truncated nvim left cluster from its plain segments, so width-based truncation runs
	// on plain text only; the reverse-video badge and provider/model accents are re-applied last.
	private recomposeNvimLeft(
		badgePlain: string,
		badgeRerender: ((t: string) => string) | undefined,
		provider: string,
		modelId: string,
		badgeGap: string,
		withProvider: boolean,
		maxWidth: number,
	): { plain: string; render: string } {
		const segs: { plain: string; color: string; badgeRerender?: (t: string) => string }[] = [];
		if (badgePlain) segs.push({ plain: badgePlain, color: "", badgeRerender });
		if (withProvider) {
			if (badgeGap) segs.push({ plain: badgeGap, color: "" });
			// Provider is decorative and is sacrificed FIRST; modelId is the core identity and is protected
			// down to NVIM_MIN_MODEL_WIDTH characters (or its full length if shorter) before the provider gets
			// anything at all -- matches the same floor renderNvimStatusline already budgeted the status around,
			// so a long provider can never crowd the model id out the way an over-long model id used to crowd
			// out the status.
			const afterBadgeGap = Math.max(0, maxWidth - safeVisibleWidth(badgePlain) - safeVisibleWidth(badgeGap));
			const modelReserve = Math.min(safeVisibleWidth(modelId), NVIM_MIN_MODEL_WIDTH, afterBadgeGap);
			const separatorWidth = provider && modelId ? safeVisibleWidth(" · ") : 0;
			const providerBudget = Math.max(0, afterBadgeGap - modelReserve - separatorWidth);
			const providerShown = provider ? this.truncatePlain(provider, providerBudget, "") : "";
			if (providerShown) {
				segs.push({ plain: providerShown, color: "dim" });
				segs.push({ plain: " · ", color: "dim" });
			}
			if (modelId) segs.push({ plain: modelId, color: "muted" });
		} else {
			if (badgeGap) segs.push({ plain: badgeGap, color: "" });
			if (modelId) segs.push({ plain: modelId, color: "muted" });
		}

		let plain = "";
		let render = "";
		let remaining = maxWidth;
		for (const seg of segs) {
			if (remaining <= 0) break;
			const segWidth = safeVisibleWidth(seg.plain);
			const fits = segWidth <= remaining;
			const keep = fits ? seg.plain : this.truncatePlain(seg.plain, remaining, "");
			if (fits) remaining -= segWidth;
			else remaining = 0;
			plain += keep;
			if (seg.badgeRerender) {
				render += seg.badgeRerender(keep);
			} else if (seg.color) {
				render += this.tone(seg.color, keep);
			} else {
				render += keep;
			}
		}
		return { plain, render };
	}

	// US-023: the nvim layout's top-rule branch label, degraded by width in two monotonic rungs -- full
	// `⎇ name +N -M`, then `⎇ name` (LOC first: churn yields to identity), then null (plain rule).
	// Name comes from the same provider the statusline used, normalized like status text and capped at
	// NVIM_BRANCH_MAX; the string itself is the shared buildBranchBadge output, colours included.
	private nvimTopRuleLabel(width: number): { plain: string; rendered: string } | null {
		const info = this.getBranch?.();
		const branch = info?.branch ? normalizeSingleLine(stripAnsi(info.branch)) : "";
		if (!branch) return null;
		const name = this.truncatePlain(branch, NVIM_BRANCH_MAX, "…");
		const insertions = info?.insertions;
		const deletions = info?.deletions;
		// A rung fits when 2 leading rule dashes + ' label ' + 1 trailing dash still fit the width.
		const fits = (badge: { plain: string } | null) => Boolean(badge && safeVisibleWidth(badge.plain) + 5 <= width);
		// FINAL user-approved colouring (round 5): ⎇ and the branch name take the `muted` tone -- the
		// SAME tier the model id uses on the bar, because the branch is identity like the model id; the
		// rule's dashes keep their own ruleFg colorizer and the LOC numbers keep success/error.
		const nvimTones = { icon: "muted" as const, name: "muted" as const, ins: "success" as const, del: "error" as const };
		// User round-4: bare LOC (`+2 -1`, no brackets) per the gitsigns/lualine convention -- real nvim
		// shows diffs unbracketed, colour separates the numbers. Format still owned by buildBranchBadge
		// via its `style` mode; the legacy call sites never pass it and stay byte-identical.
		const full = this.buildBranchBadge(name, insertions, deletions, true, nvimTones, "bare");
		if (fits(full)) return full;
		const nameOnly = this.buildBranchBadge(name, insertions, deletions, false, nvimTones, "bare");
		if (fits(nameOnly)) return nameOnly;
		return null;
	}

	private renderNvimLayout(inputLines: string[], autocompleteLines: string[], width: number, _contentInnerWidth: number): string[] {
		const lines: string[] = [...this.renderInputBoxFrame(inputLines, width, this.nvimTopRuleLabel(width)), this.renderNvimStatusline(width)];
		return this.appendAutocomplete(lines, autocompleteLines, width);
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

	private renderCliDockLayout(inputLines: string[], autocompleteLines: string[], width: number, contentInnerWidth: number): string[] {
		const lines: string[] = [];
		lines.push(...this.renderInputBoxFrame(inputLines, contentInnerWidth).map((line) => this.renderPanelLine(line, width)));
		// Align the status row with the text inside the outline box (border + gap) instead of the box edges.
		const statusInset = Math.min(CLI_DOCK_STATUS_INSET, Math.floor(Math.max(0, contentInnerWidth - 1) / 2));
		const statusPad = " ".repeat(statusInset);
		const statusLine = this.renderCliDockStatusLine(Math.max(1, contentInnerWidth - statusInset * 2));
		lines.push(this.renderPanelLine(`${statusPad}${statusLine}${statusPad}`, width));
		return this.appendAutocomplete(lines, autocompleteLines, width);
	}

	render(width: number): string[] {
		const editorStyle = this.userZoneStyle.editor;
		const contentInnerWidth = this.panelContentWidth(width);
		const text = this.getText();
		const promptColor = editorStyle.prompt === "❯"
			? this.themeExtraColor("userPrefixColor", editorStyle.promptColor)
			: editorStyle.layout === "cli-dock"
				? editorStyle.promptColor
				: this.themeExtraColor("bashPromptColor", editorStyle.promptColor);
		const promptText = this.styleFg(promptColor, editorStyle.prompt);
		const prompt = editorStyle.promptBold ? this.bold(promptText) : promptText;
		const promptPrefix = `${editorStyle.layout === "cli-dock" ? " " : ""}${prompt}${" ".repeat(Math.max(0, editorStyle.promptGap))}`;
		const prefixWidth = safeVisibleWidth(promptPrefix);
		const inputInnerWidth = Math.max(1, contentInnerWidth - (editorStyle.layout === "cli-dock" ? 2 : 0));
		const contentWidth = Math.max(1, inputInnerWidth - prefixWidth);
		const parentLines = super.render(contentWidth);
		if (parentLines.length === 0) return parentLines;

		const bottomBorderIndex = findLastBorderIndex(parentLines);
		const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];
		const displayLines = this.renderInputContentLines(text, contentWidth);
		if (editorStyle.placeholder && text.length === 0 && displayLines[0] !== undefined) {
			const placeholder = this.tone("dim", editorStyle.placeholder);
			const available = Math.max(0, contentWidth - safeVisibleWidth(displayLines[0]));
			displayLines[0] = `${displayLines[0]}${safeVisibleWidth(placeholder) > available ? safeTruncateToWidth(placeholder, available, "") : placeholder}`;
		}

		const inputLines = displayLines.map((line, index) => {
			const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
			const available = Math.max(1, inputInnerWidth - safeVisibleWidth(prefix));
			const row = `${prefix}${this.pad(line, available)}`;
			return editorStyle.layout === "cli-dock" ? this.pad(row, inputInnerWidth) : this.renderPanelLine(row, width);
		});

		const layoutRenderers: Record<string, (inputLines: string[], autocompleteLines: string[], width: number, contentInnerWidth: number) => string[]> = {
			"cli-dock": (il, al, w, ciw) => this.renderCliDockLayout(il, al, w, ciw),
			"gemini": (il, al, w, ciw) => this.renderGeminiLayout(il, al, w, ciw),
			"droid": (il, al, w, ciw) => this.renderDroidLayout(il, al, w, ciw),
			"nvim": (il, al, w, ciw) => this.renderNvimLayout(il, al, w, ciw),
		};
		const renderer = layoutRenderers[editorStyle.layout] ?? layoutRenderers.droid;
		return renderer(inputLines, autocompleteLines, width, contentInnerWidth);
	}
}
