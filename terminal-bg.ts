/**
 * Set/restore terminal background and foreground colors using OSC escape sequences.
 * Works in most modern terminal emulators (iTerm2, kitty, alacritty, wezterm, etc.)
 */

function hexToOscRgb(hex: string): string {
	const cleaned = hex.replace("#", "");
	const r = cleaned.slice(0, 2);
	const g = cleaned.slice(2, 4);
	const b = cleaned.slice(4, 6);
	return `${r}/${g}/${b}`;
}

export function applyTerminalBg(bgHex: string, fgHex?: string): void {
	if (bgHex && bgHex.length >= 6) {
		process.stdout.write(`\x1b]11;rgb:${hexToOscRgb(bgHex)}\x07`);
	}
	if (fgHex && fgHex.length >= 6) {
		process.stdout.write(`\x1b]10;rgb:${hexToOscRgb(fgHex)}\x07`);
	}
}

export function restoreTerminalBg(): void {
	// OSC 111 resets bg, OSC 110 resets fg to terminal defaults
	process.stdout.write(`\x1b]111\x07\x1b]110\x07`);
}
