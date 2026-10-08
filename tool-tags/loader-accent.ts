import { fgHex, parseFgAnsiToRgb, rgbToHex } from "../theme/ansi.js";

export type WorkingLoaderState = "working" | "thinking" | "answering" | "running";
export type WorkingLoaderMessages = Record<WorkingLoaderState, string>;

export interface WorkingLoaderTheme {
	fg?(color: string, text: string): string;
	bold?(text: string): string;
	getFgAnsi?(color: string): string;
	getColorMode?(): string;
}

export interface WorkingLoaderUi {
	theme?: WorkingLoaderTheme;
	setWorkingMessage(message?: string): void;
	setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
}

export interface WorkingLoaderController {
	configure(): void;
	start(state?: WorkingLoaderState): void;
	setState(state: WorkingLoaderState): void;
	stop(): void;
	dispose(): void;
}

/**
 * A slowly breathing hollow circle: one glyph that never changes shape, fading accent -> toward
 * dim -> accent, so it moves by light like the label shimmer does. `dim` is the
 * theme's low-contrast tone, so the fade reads as brightness in dark and light
 * themes alike; `muted` can sit as bright as accent and hide the breath.
 */
export const SPINNER_GLYPH = "○";
export const SPINNER_BREATH_FRAMES = 24;
export const SPINNER_INTERVAL_MS = 100;
/** How far the glyph fades toward dim at the bottom of a breath; it never fully disappears. */
const SPINNER_MAX_FADE = 0.85;
/** One shimmer step per tick: the highlight moves one character each time. */
export const WORKING_MESSAGE_INTERVAL_MS = 80;
/** Ticks the shimmer rests after each sweep across the label. */
const SHIMMER_REST_STEPS = 6;

const WORKING_STATE_LABELS: WorkingLoaderMessages = {
	working: "Working",
	thinking: "Thinking",
	answering: "Answering",
	running: "Cooking",
};

function themeFg(theme: WorkingLoaderTheme | undefined, color: string, text: string): string {
	if (!theme?.fg) return text;
	for (const fallbackColor of [color, "accent", "text"]) {
		try {
			return theme.fg(fallbackColor, text);
		} catch {}
	}
	return text;
}

/**
 * A bright highlight sweeping over `label` one character per step, resting a
 * few steps between sweeps: the head is bold text, its neighbours text, the
 * rest muted.
 */
function shimmer(label: string, step: number, theme?: WorkingLoaderTheme): string {
	const chars = [...label];
	const head = Math.max(0, Math.floor(step)) % (chars.length + SHIMMER_REST_STEPS);
	return chars
		.map((char, index) => {
			const distance = Math.abs(index - head);
			if (distance === 0) return themeFg(theme, "text", theme?.bold ? theme.bold(char) : char);
			if (distance === 1) return themeFg(theme, "text", char);
			return themeFg(theme, "muted", char);
		})
		.join("");
}

function themeRgb(theme: WorkingLoaderTheme | undefined, color: string): { r: number; g: number; b: number } | undefined {
	try {
		const ansi = theme?.getFgAnsi?.(color);
		return ansi ? parseFgAnsiToRgb(ansi) : undefined;
	} catch {
		return undefined;
	}
}
export function renderWorkingMessage(
	state: WorkingLoaderState,
	step: number,
	theme?: WorkingLoaderTheme,
	messages: WorkingLoaderMessages = WORKING_STATE_LABELS,
): string {
	return shimmer(messages[state] ?? WORKING_STATE_LABELS[state], step, theme);
}

/**
 * One breath of the glyph, pre-coloured: a cosine ease from accent toward dim
 * and back. A theme whose colours cannot be read gets a steady accent glyph.
 */
export function createWorkingIndicatorFrames(theme?: WorkingLoaderTheme): string[] {
	const accent = themeRgb(theme, "accent");
	const dim = themeRgb(theme, "dim");
	if (!accent || !dim) return [themeFg(theme, "accent", SPINNER_GLYPH)];
	return Array.from({ length: SPINNER_BREATH_FRAMES }, (_, index) => {
		const fade = SPINNER_MAX_FADE * (1 - Math.cos((2 * Math.PI * index) / SPINNER_BREATH_FRAMES)) / 2;
		const rgb = {
			r: accent.r + (dim.r - accent.r) * fade,
			g: accent.g + (dim.g - accent.g) * fade,
			b: accent.b + (dim.b - accent.b) * fade,
		};
		return fgHex(theme, rgbToHex(rgb), SPINNER_GLYPH);
	});
}

export function workingStateForAssistantMessage(message: unknown): WorkingLoaderState {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "thinking";
	let hasAnswerText = false;
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const part = item as { type?: unknown; text?: unknown };
		if (part.type === "toolCall") return "running";
		if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) hasAnswerText = true;
	}
	return hasAnswerText ? "answering" : "thinking";
}

export function createWorkingLoaderController(ui: WorkingLoaderUi, messages?: WorkingLoaderMessages): WorkingLoaderController {
	let state: WorkingLoaderState = "working";
	let step = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	const render = () => {
		ui.setWorkingMessage(renderWorkingMessage(state, step, ui.theme, messages));
	};

	const clearTimer = () => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};

	const setState = (nextState: WorkingLoaderState) => {
		if (state === nextState) return;
		state = nextState;
		step = 0;
		render();
	};

	const start = (nextState: WorkingLoaderState = "working") => {
		clearTimer();
		state = nextState;
		step = 0;
		render();
		timer = setInterval(() => {
			step += 1;
			render();
		}, WORKING_MESSAGE_INTERVAL_MS);
	};

	const stop = () => {
		clearTimer();
		state = "working";
		step = 0;
	};

	return {
		configure() {
			ui.setWorkingIndicator({ frames: createWorkingIndicatorFrames(ui.theme), intervalMs: SPINNER_INTERVAL_MS });
			render();
		},
		start,
		setState,
		stop,
		dispose() {
			clearTimer();
		},
	};
}
