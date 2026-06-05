export const USER_ZONE_STYLE_NAMES = ["droid", "gemini"] as const;

export type UserZoneStyleName = typeof USER_ZONE_STYLE_NAMES[number];

type UserZoneStyleNameSet = Record<UserZoneStyleName, true>;

export interface UserZoneEditorStyle {
	layout: "droid" | "gemini";
	panelPaddingX: number;
	prompt: string;
	promptColor: string;
	promptBold: boolean;
	promptGap: number;
	showHostBorder: boolean;
	hostBorderFill: string;
	hostPrefixColor: string;
	hostBorderColor: string;
	showMetadataRow: boolean;
	showRuntimeRow: boolean;
	showDivider: boolean;
	dividerChar: string;
	dividerColor: string;
	dividerBold: boolean;
	showTrailingBlankLine: boolean;
	slashBorderColor: string;
	inputBackgroundColor: string;
	inputFrame: "auto" | "none" | "halfblock" | "line";
	footerLabelColor: string;
	footerValueColor: string;
}

export interface UserZoneFixedStyle {
	jumpTopHint: string;
	jumpBottomHint: string;
	scrollHintRightInset: number;
	scrollHintPlacement: "cursor" | "lastLine";
	showScrollbar: boolean;
	scrollbarGlyph: string;
	scrollbarTrackColor: string;
	scrollbarThumbColor: string;
	scrollbarThumbActiveColor: string;
}

export interface UserZoneStyle {
	name: UserZoneStyleName;
	editor: UserZoneEditorStyle;
	fixed: UserZoneFixedStyle;
}

const USER_ZONE_STYLE_NAME_SET: UserZoneStyleNameSet = {
	droid: true,
	gemini: true,
};

export const DEFAULT_USER_ZONE_STYLE: UserZoneStyleName = "gemini";
export const FALLBACK_USER_ZONE_STYLE: UserZoneStyleName = "droid";

export const USER_ZONE_STYLES: Record<UserZoneStyleName, UserZoneStyle> = {
	droid: {
		name: "droid",
		editor: {
			layout: "droid",
			panelPaddingX: 2,
			prompt: "❯",
			promptColor: "accent",
			promptBold: true,
			promptGap: 2,
			showHostBorder: true,
			hostBorderFill: "⋯",
			hostPrefixColor: "accent",
			hostBorderColor: "border",
			showMetadataRow: true,
			showRuntimeRow: true,
			showDivider: true,
			dividerChar: "━",
			dividerColor: "border",
			dividerBold: true,
			showTrailingBlankLine: true,
			slashBorderColor: "border",
			inputBackgroundColor: "selectedBg",
			inputFrame: "none",
			footerLabelColor: "dim",
			footerValueColor: "muted",
		},
		fixed: {
			jumpTopHint: "^Alt T TOP",
			jumpBottomHint: "^Alt G BOT",
			scrollHintRightInset: 2,
			scrollHintPlacement: "cursor",
			showScrollbar: true,
			scrollbarGlyph: "█",
			scrollbarTrackColor: "borderMuted",
			scrollbarThumbColor: "dim",
			scrollbarThumbActiveColor: "muted",
		},
	},
	gemini: {
		name: "gemini",
		editor: {
			layout: "gemini",
			panelPaddingX: 1,
			prompt: "❯",
			promptColor: "accent",
			promptBold: true,
			promptGap: 2,
			showHostBorder: false,
			hostBorderFill: "",
			hostPrefixColor: "accent",
			hostBorderColor: "borderMuted",
			showMetadataRow: false,
			showRuntimeRow: true,
			showDivider: true,
			dividerChar: "─",
			dividerColor: "border",
			dividerBold: true,
			showTrailingBlankLine: false,
			slashBorderColor: "borderMuted",
			inputBackgroundColor: "selectedBg",
			inputFrame: "auto",
			footerLabelColor: "dim",
			footerValueColor: "dim",
		},
		fixed: {
			jumpTopHint: "^Alt T TOP",
			jumpBottomHint: "^Alt G BOT",
			scrollHintRightInset: 0,
			scrollHintPlacement: "lastLine",
			showScrollbar: true,
			scrollbarGlyph: "█",
			scrollbarTrackColor: "borderMuted",
			scrollbarThumbColor: "dim",
			scrollbarThumbActiveColor: "muted",
		},
	},
};

export function isUserZoneStyleName(value: unknown): value is UserZoneStyleName {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(USER_ZONE_STYLE_NAME_SET, value);
}

export function normalizeUserZoneStyleName(value: unknown): UserZoneStyleName {
	if (value === undefined) return DEFAULT_USER_ZONE_STYLE;
	return isUserZoneStyleName(value) ? value : FALLBACK_USER_ZONE_STYLE;
}

export function resolveUserZoneStyle(value: unknown): UserZoneStyle {
	return USER_ZONE_STYLES[normalizeUserZoneStyleName(value)];
}
