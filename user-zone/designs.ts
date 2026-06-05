export const USER_ZONE_STYLE_NAMES = ["droid", "compact", "minimal"] as const;

export type UserZoneStyleName = typeof USER_ZONE_STYLE_NAMES[number];

type UserZoneStyleNameSet = Record<UserZoneStyleName, true>;

export interface UserZoneEditorStyle {
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
}

export interface UserZoneFixedStyle {
	jumpTopHint: string;
	jumpBottomHint: string;
	scrollHintRightInset: number;
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
	compact: true,
	minimal: true,
};

export const DEFAULT_USER_ZONE_STYLE: UserZoneStyleName = "droid";

export const USER_ZONE_STYLES: Record<UserZoneStyleName, UserZoneStyle> = {
	droid: {
		name: "droid",
		editor: {
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
		},
		fixed: {
			jumpTopHint: "^Shift T TOP",
			jumpBottomHint: "^Shift G BOT",
			scrollHintRightInset: 2,
			showScrollbar: true,
			scrollbarGlyph: "█",
			scrollbarTrackColor: "borderMuted",
			scrollbarThumbColor: "dim",
			scrollbarThumbActiveColor: "muted",
		},
	},
	compact: {
		name: "compact",
		editor: {
			panelPaddingX: 1,
			prompt: "›",
			promptColor: "accent",
			promptBold: true,
			promptGap: 1,
			showHostBorder: false,
			hostBorderFill: "─",
			hostPrefixColor: "accent",
			hostBorderColor: "borderMuted",
			showMetadataRow: true,
			showRuntimeRow: true,
			showDivider: false,
			dividerChar: "─",
			dividerColor: "borderMuted",
			dividerBold: false,
			showTrailingBlankLine: false,
			slashBorderColor: "borderMuted",
		},
		fixed: {
			jumpTopHint: "^T TOP",
			jumpBottomHint: "^G BOT",
			scrollHintRightInset: 1,
			showScrollbar: true,
			scrollbarGlyph: "▌",
			scrollbarTrackColor: "borderMuted",
			scrollbarThumbColor: "muted",
			scrollbarThumbActiveColor: "accent",
		},
	},
	minimal: {
		name: "minimal",
		editor: {
			panelPaddingX: 1,
			prompt: "›",
			promptColor: "accent",
			promptBold: false,
			promptGap: 1,
			showHostBorder: false,
			hostBorderFill: "",
			hostPrefixColor: "accent",
			hostBorderColor: "borderMuted",
			showMetadataRow: false,
			showRuntimeRow: false,
			showDivider: false,
			dividerChar: "",
			dividerColor: "borderMuted",
			dividerBold: false,
			showTrailingBlankLine: false,
			slashBorderColor: "borderMuted",
		},
		fixed: {
			jumpTopHint: "",
			jumpBottomHint: "",
			scrollHintRightInset: 0,
			showScrollbar: false,
			scrollbarGlyph: "▌",
			scrollbarTrackColor: "borderMuted",
			scrollbarThumbColor: "muted",
			scrollbarThumbActiveColor: "accent",
		},
	},
};

export function isUserZoneStyleName(value: unknown): value is UserZoneStyleName {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(USER_ZONE_STYLE_NAME_SET, value);
}

export function normalizeUserZoneStyleName(value: unknown): UserZoneStyleName {
	return isUserZoneStyleName(value) ? value : DEFAULT_USER_ZONE_STYLE;
}

export function resolveUserZoneStyle(value: unknown): UserZoneStyle {
	return USER_ZONE_STYLES[normalizeUserZoneStyleName(value)];
}
