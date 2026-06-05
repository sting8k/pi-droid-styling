import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { DEFAULT_USER_ZONE_STYLE, isUserZoneStyleName, normalizeUserZoneStyleName, type UserZoneStyleName } from "./user-zone/designs.js";

export type CustomWorkingMessageConfig = Record<"working" | "thinking" | "answering" | "running", string>;

export interface DroidStylingConfig {
	alwaysExpanded: boolean;
	maxExpandedLines: number;
	dimToolOutput: boolean;
	customWorkingMessage: CustomWorkingMessageConfig;
	userZoneStyle: UserZoneStyleName;
	fixedUserZone: boolean;
	forceOSC11: boolean;
}

const DEFAULT_CUSTOM_WORKING_MESSAGE: CustomWorkingMessageConfig = {
	working: "Working",
	thinking: "Thinking",
	answering: "Answering",
	running: "Cooking",
};

const DEFAULTS: DroidStylingConfig = {
	alwaysExpanded: false,
	maxExpandedLines: 50,
	dimToolOutput: false,
	customWorkingMessage: DEFAULT_CUSTOM_WORKING_MESSAGE,
	userZoneStyle: DEFAULT_USER_ZONE_STYLE,
	fixedUserZone: false,
	forceOSC11: false,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-droid-styling.json");
const MAX_EXPANDED_LINES_LIMIT = 1000;
const DEPRECATED_CONFIG_KEYS = ["fixedUserZoneMouseScroll", "fixedUserZoneSidebar"] as const;

let cached: DroidStylingConfig = defaultConfig();
let cachedMtimeMs = -1;
let lastStatAt = 0;
const STAT_INTERVAL_MS = 1000;

function defaultCustomWorkingMessage(): CustomWorkingMessageConfig {
	return { ...DEFAULT_CUSTOM_WORKING_MESSAGE };
}

function defaultConfig(): DroidStylingConfig {
	return { ...DEFAULTS, customWorkingMessage: defaultCustomWorkingMessage() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function maxExpandedLinesOrDefault(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.maxExpandedLines;
	const normalized = Math.floor(value);
	if (normalized < 0) return DEFAULTS.maxExpandedLines;
	return Math.min(normalized, MAX_EXPANDED_LINES_LIMIT);
}

function customWorkingMessageOrDefault(value: unknown): CustomWorkingMessageConfig {
	const labels = defaultCustomWorkingMessage();
	if (!isRecord(value)) return labels;
	for (const key of Object.keys(labels) as Array<keyof CustomWorkingMessageConfig>) {
		const label = value[key];
		if (typeof label === "string" && label.trim().length > 0) labels[key] = label;
	}
	return labels;
}

function defaultValueForKey(key: keyof DroidStylingConfig): unknown {
	return key === "customWorkingMessage" ? defaultCustomWorkingMessage() : DEFAULTS[key];
}

function backfillCustomWorkingMessage(config: Record<string, unknown>): boolean {
	const value = config.customWorkingMessage;
	if (!isRecord(value)) {
		config.customWorkingMessage = defaultCustomWorkingMessage();
		return true;
	}
	let changed = false;
	for (const key of Object.keys(DEFAULT_CUSTOM_WORKING_MESSAGE) as Array<keyof CustomWorkingMessageConfig>) {
		const label = value[key];
		if (typeof label === "string" && label.trim().length > 0) continue;
		value[key] = DEFAULT_CUSTOM_WORKING_MESSAGE[key];
		changed = true;
	}
	return changed;
}

function backfillUserZoneStyle(config: Record<string, unknown>): boolean {
	const value = config.userZoneStyle;
	if (value === undefined) {
		config.userZoneStyle = DEFAULT_USER_ZONE_STYLE;
		return true;
	}
	if (isUserZoneStyleName(value)) return false;
	if (typeof value === "string" && value.trim().length > 0) return false;
	config.userZoneStyle = DEFAULT_USER_ZONE_STYLE;
	return true;
}

function normalizeConfig(raw: unknown): DroidStylingConfig {
	if (!isRecord(raw)) return defaultConfig();
	const config = raw as Record<string, unknown>;
	return {
		alwaysExpanded: booleanOrDefault(config.alwaysExpanded, DEFAULTS.alwaysExpanded),
		maxExpandedLines: maxExpandedLinesOrDefault(config.maxExpandedLines),
		dimToolOutput: booleanOrDefault(config.dimToolOutput, DEFAULTS.dimToolOutput),
		customWorkingMessage: customWorkingMessageOrDefault(config.customWorkingMessage),
		userZoneStyle: normalizeUserZoneStyleName(config.userZoneStyle),
		fixedUserZone: booleanOrDefault(config.fixedUserZone, DEFAULTS.fixedUserZone),
		forceOSC11: booleanOrDefault(config.forceOSC11, DEFAULTS.forceOSC11),
	};
}

function scaffoldIfMissing(): void {
	if (existsSync(CONFIG_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2) + "\n", "utf-8");
	} catch {
		// ignore — read path will fall back to normalized defaults
	}
}

function backfillMissingDefaults(raw: unknown): void {
	if (!isRecord(raw)) return;
	const config = raw as Record<string, unknown>;
	let changed = false;
	for (const key of DEPRECATED_CONFIG_KEYS) {
		if (!(key in config)) continue;
		delete config[key];
		changed = true;
	}
	for (const key of Object.keys(DEFAULTS) as Array<keyof DroidStylingConfig>) {
		if (key in config) continue;
		config[key] = defaultValueForKey(key);
		changed = true;
	}
	if (backfillCustomWorkingMessage(config)) changed = true;
	if (backfillUserZoneStyle(config)) changed = true;
	if (!changed) return;
	try {
		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	} catch {
		// ignore — read path will keep using normalized defaults
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
			cached = defaultConfig();
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
		cached = defaultConfig();
	}
	return cached;
}
