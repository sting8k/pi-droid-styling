import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Loader } from "@mariozechner/pi-tui";

const PATCH_FLAG = "__loaderAccentPatched__";
const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
const SPINNER_INTERVAL = 40;

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

function getRandomVibe(): string | null {
	const vibes = loadVibes();
	if (vibes.length === 0) return null;
	return vibes[Math.floor(Math.random() * vibes.length)]!;
}

export function installLoaderAccent(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = Loader.prototype as any;
	if (!proto || typeof proto.start !== "function") return;

	const baseStart = proto.start;
	proto.start = function patchedLoaderStart(this: any, ...args: any[]) {
		this.frames = SPINNER_FRAMES;
		this.messageColorFn = this.spinnerColorFn;

		const vibe = getRandomVibe();
		if (vibe) {
			this.message = vibe;
		}

		baseStart.apply(this, args);
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = setInterval(() => {
				this.currentFrame = (this.currentFrame + 1) % this.frames.length;
				this.updateDisplay();
			}, SPINNER_INTERVAL);
		}
	};
}
