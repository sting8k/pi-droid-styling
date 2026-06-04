import { isHexColor } from "./ansi.js";
import { getThemePageBackground } from "./theme-extras.js";

type TerminalLike = {
	write?: (data: string) => unknown;
};

type TerminalBackgroundOscOptions = {
	force?: boolean;
	platform?: string;
	env?: Record<string, string | undefined>;
};

const OSC11_SET_BACKGROUND_PREFIX = "\x1b]11;";
const OSC111_RESET_BACKGROUND = "\x1b]111\x07";

function isWindowsHost(platform: string = process.platform, env: Record<string, string | undefined> = process.env): boolean {
	return platform === "win32" || Boolean(env.WT_SESSION || env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function normalizeOscHexColor(value: string): string {
	let hex = value.trim().replace(/^#/, "");
	if (hex.length === 3) hex = hex.split("").map((char) => `${char}${char}`).join("");
	if (hex.length > 6) hex = hex.slice(0, 6);
	return `#${hex}`;
}

export function shouldApplyTerminalBackgroundOsc11(options: TerminalBackgroundOscOptions = {}): boolean {
	if (options.force === true) return true;
	return !isWindowsHost(options.platform ?? process.platform, options.env ?? process.env);
}

export function terminalBackgroundOsc11(hex: string): string {
	return `${OSC11_SET_BACKGROUND_PREFIX}${normalizeOscHexColor(hex)}\x07`;
}

export function resetTerminalBackgroundOsc111(): string {
	return OSC111_RESET_BACKGROUND;
}

export function applyTerminalPageBackgroundOsc11(theme: any, terminal: TerminalLike, options: TerminalBackgroundOscOptions = {}): (() => void) | undefined {
	if (!shouldApplyTerminalBackgroundOsc11(options)) return undefined;
	const pageBg = getThemePageBackground(theme);
	if (!isHexColor(pageBg) || typeof terminal?.write !== "function") return undefined;

	const write = terminal.write.bind(terminal);
	try {
		write(terminalBackgroundOsc11(pageBg));
	} catch {
		return undefined;
	}

	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		try {
			write(resetTerminalBackgroundOsc111());
		} catch {
			// Best effort only; do not let terminal integration affect shutdown.
		}
	};
}
