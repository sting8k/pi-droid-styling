import type { FixedZoneNoticeTheme } from "./notice.js";
import type { FixedZoneSidebarTheme } from "./sidebar.js";
import { resolveFrameBackgroundAnsi } from "../theme/frame-background.js";

type HostThemeLike = {
	fg?: (color: any, text: string) => string;
	bg?: (color: any, text: string) => string;
	bold?: (text: string) => string;
	inverse?: (text: string) => string;
};

export type FixedZoneTheme = FixedZoneNoticeTheme & FixedZoneSidebarTheme & { frameBgAnsi?: () => string };

function inverse(text: string): string {
	return `\x1b[7m${text}\x1b[27m`;
}

export function createFixedZoneTheme(theme: HostThemeLike | undefined): FixedZoneTheme {
	return {
		fg: (color: string, text: string) => {
			try {
				return typeof theme?.fg === "function" ? theme.fg(color, text) : text;
			} catch {
				return text;
			}
		},
		bg: (color: string, text: string) => {
			try {
				return typeof theme?.bg === "function" ? theme.bg(color, text) : inverse(text);
			} catch {
				return inverse(text);
			}
		},
		bold: (text: string) => {
			try {
				return typeof theme?.bold === "function" ? theme.bold(text) : text;
			} catch {
				return text;
			}
		},
		inverse: (text: string) => {
			try {
				return typeof theme?.inverse === "function" ? theme.inverse(text) : inverse(text);
			} catch {
				return inverse(text);
			}
		},
		frameBgAnsi: () => resolveFrameBackgroundAnsi(theme),
	};
}
