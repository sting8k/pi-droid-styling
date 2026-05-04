import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
export const SPINNER_INTERVAL_MS = 120;

let cachedVibes: string[] | null = null;

function loadVibes(): string[] {
	if (cachedVibes !== null) return cachedVibes;
	const vibesPath = join(homedir(), ".pi", "agent", "vibes", "relax.txt");
	try {
		if (existsSync(vibesPath)) {
			const lines = readFileSync(vibesPath, "utf-8")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
			if (lines.length > 0) {
				cachedVibes = lines;
				return cachedVibes;
			}
		}
	} catch {}
	cachedVibes = [];
	return cachedVibes;
}

export function getRandomWorkingMessage(): string | undefined {
	const vibes = loadVibes();
	if (vibes.length === 0) return undefined;
	return vibes[Math.floor(Math.random() * vibes.length)]!;
}
