import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export interface DroidStylingConfig {
	alwaysExpanded: boolean;
	maxExpandedLines: number;
	dimToolOutput: boolean;
	customWorkingMessage: boolean;
}

const DEFAULTS: DroidStylingConfig = {
	alwaysExpanded: false,
	maxExpandedLines: 80,
	dimToolOutput: false,
	customWorkingMessage: false,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-droid-styling.json");

let cached: DroidStylingConfig = { ...DEFAULTS };
let cachedMtimeMs = -1;
let lastStatAt = 0;
const STAT_INTERVAL_MS = 1000;

function scaffoldIfMissing(): void {
	if (existsSync(CONFIG_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
	} catch {
		// ignore — read path will fall back to DEFAULTS
	}
}

export function loadConfig(): DroidStylingConfig {
	const now = Date.now();
	if (now - lastStatAt < STAT_INTERVAL_MS) return cached;
	lastStatAt = now;

	let mtimeMs = -1;
	try {
		mtimeMs = statSync(CONFIG_PATH).mtimeMs;
	} catch {
		scaffoldIfMissing();
		try {
			mtimeMs = statSync(CONFIG_PATH).mtimeMs;
		} catch {
			cached = { ...DEFAULTS };
			cachedMtimeMs = -1;
			return cached;
		}
	}

	if (mtimeMs === cachedMtimeMs) return cached;
	cachedMtimeMs = mtimeMs;
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		cached = { ...DEFAULTS, ...raw };
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}
