import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";

export type FixedZoneNoticeKind = "info" | "success" | "warning" | "error";

export interface FixedZoneNotice {
	kind: FixedZoneNoticeKind;
	message: string;
}

export interface FixedZoneNoticeTheme {
	fg?(color: string, text: string): string;
	bg?(color: string, text: string): string;
	bold?(text: string): string;
	inverse?(text: string): string;
}

type NoticeStyle = {
	label: string;
	labelFg: string;
	rowBg: string;
	messageFg: string;
};

const NOTICE_STYLES: Record<FixedZoneNoticeKind, NoticeStyle> = {
	info: { label: "INFO!", labelFg: "accent", rowBg: "selectedBg", messageFg: "text" },
	success: { label: "OKAY!", labelFg: "success", rowBg: "selectedBg", messageFg: "text" },
	warning: { label: "WARN!", labelFg: "warning", rowBg: "selectedBg", messageFg: "text" },
	error: { label: "FAIL!", labelFg: "error", rowBg: "selectedBg", messageFg: "text" },
};

export function defaultFixedZoneNoticeTtlMs(kind: FixedZoneNoticeKind): number {
	return kind === "warning" || kind === "error" ? 7000 : 3000;
}

export function fixedZoneNoticeKey(notice: FixedZoneNotice | null): string {
	return notice ? `${notice.kind}:${notice.message}` : "none";
}

function sanitizeNoticeMessage(message: string): string {
	return message.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function themeFg(theme: FixedZoneNoticeTheme | undefined, color: string, text: string): string {
	try {
		return theme?.fg ? theme.fg(color, text) : text;
	} catch {
		return text;
	}
}

function themeBg(theme: FixedZoneNoticeTheme | undefined, color: string, text: string): string {
	try {
		return theme?.bg ? theme.bg(color, text) : `\x1b[7m${text}\x1b[27m`;
	} catch {
		return `\x1b[7m${text}\x1b[27m`;
	}
}

function themeBold(theme: FixedZoneNoticeTheme | undefined, text: string): string {
	try {
		return theme?.bold ? theme.bold(text) : `\x1b[1m${text}\x1b[22m`;
	} catch {
		return `\x1b[1m${text}\x1b[22m`;
	}
}
function themeInverse(theme: FixedZoneNoticeTheme | undefined, text: string): string {
	try {
		return theme?.inverse ? theme.inverse(text) : `\x1b[7m${text}\x1b[27m`;
	} catch {
		return `\x1b[7m${text}\x1b[27m`;
	}
}

function padStyledLine(line: string, width: number): string {
	const lineWidth = safeVisibleWidth(line);
	if (lineWidth > width) return safeTruncateToWidth(line, width, "");
	return `${line}${" ".repeat(Math.max(0, width - lineWidth))}`;
}

function rowBackground(theme: FixedZoneNoticeTheme | undefined, style: NoticeStyle, text: string): string {
	return themeBg(theme, style.rowBg, text);
}

export function renderFixedZoneNoticeFooter(notice: FixedZoneNotice | null, width: number, theme?: FixedZoneNoticeTheme): string {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth <= 0 || !notice) return "";

	const style = NOTICE_STYLES[notice.kind];
	const rawLabel = ` ${style.label} `;
	const labelWidth = safeVisibleWidth(rawLabel);
	const labelText = themeBold(theme, themeFg(theme, style.labelFg, rawLabel));
	const pill = themeInverse(theme, labelText);
	if (labelWidth >= safeWidth) return padStyledLine(pill, safeWidth);

	const messageWidth = Math.max(0, safeWidth - labelWidth - 1);
	const message = messageWidth > 0 ? safeTruncateToWidth(sanitizeNoticeMessage(notice.message), messageWidth, "…") : "";
	const tail = message ? ` ${themeFg(theme, style.messageFg, message)}` : "";
	const tailWidth = safeVisibleWidth(tail);
	const tailPadding = " ".repeat(Math.max(0, safeWidth - labelWidth - tailWidth));
	return `${pill}${rowBackground(theme, style, `${tail}${tailPadding}`)}`;
}
