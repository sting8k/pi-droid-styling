import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export interface DroidStylingConfig {
	alwaysExpanded: boolean;
	maxExpandedLines: number;
	dimToolOutput: boolean;
	customWorkingMessage: boolean;
	fixedUserZone: boolean;
	fixedUserZoneSidebar: boolean;
}

const DEFAULTS: DroidStylingConfig = {
	alwaysExpanded: false,
	maxExpandedLines: 50,
	dimToolOutput: false,
	customWorkingMessage: false,
	fixedUserZone: false,
	fixedUserZoneSidebar: false,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-droid-styling.json");
const MAX_EXPANDED_LINES_LIMIT = 1000;
const DEPRECATED_CONFIG_KEYS = ["fixedUserZoneMouseScroll"] as const;

let cached: DroidStylingConfig = { ...DEFAULTS };
let cachedMtimeMs = -1;
let lastStatAt = 0;
const STAT_INTERVAL_MS = 1000;

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function maxExpandedLinesOrDefault(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.maxExpandedLines;
	const normalized = Math.floor(value);
	if (normalized < 0) return DEFAULTS.maxExpandedLines;
	return Math.min(normalized, MAX_EXPANDED_LINES_LIMIT);
}

function normalizeConfig(raw: unknown): DroidStylingConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
	const config = raw as Record<string, unknown>;
	return {
		alwaysExpanded: booleanOrDefault(config.alwaysExpanded, DEFAULTS.alwaysExpanded),
		maxExpandedLines: maxExpandedLinesOrDefault(config.maxExpandedLines),
		dimToolOutput: booleanOrDefault(config.dimToolOutput, DEFAULTS.dimToolOutput),
		customWorkingMessage: booleanOrDefault(config.customWorkingMessage, DEFAULTS.customWorkingMessage),
		fixedUserZone: booleanOrDefault(config.fixedUserZone, DEFAULTS.fixedUserZone),
		fixedUserZoneSidebar: booleanOrDefault(config.fixedUserZoneSidebar, DEFAULTS.fixedUserZoneSidebar),
	};
}

function scaffoldIfMissing(): void {
	if (existsSync(CONFIG_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
	} catch {
		// ignore — read path will fall back to DEFAULTS
	}
}

function backfillMissingDefaults(raw: unknown): void {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
	const config = raw as Record<string, unknown>;
	let changed = false;
	for (const key of DEPRECATED_CONFIG_KEYS) {
		if (!(key in config)) continue;
		delete config[key];
		changed = true;
	}
	for (const [key, value] of Object.entries(DEFAULTS) as Array<[keyof DroidStylingConfig, boolean | number]>) {
		if (key in config) continue;
		config[key] = value;
		changed = true;
	}
	if (!changed) return;
	try {
		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	} catch {
		// ignore — read path will keep using normalized DEFAULTS
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
		cached = normalizeConfig(raw);
		backfillMissingDefaults(raw);
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}
