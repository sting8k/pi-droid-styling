import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface DroidStylingConfig {
	alwaysExpanded: boolean;
	maxExpandedLines: number;
	dimToolOutput: boolean;
}

const DEFAULTS: DroidStylingConfig = {
	alwaysExpanded: false,
	maxExpandedLines: 80,
	dimToolOutput: false,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-droid-styling.json");

export function loadConfig(): DroidStylingConfig {
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		return { ...DEFAULTS, ...raw };
	} catch {
		return { ...DEFAULTS };
	}
}
