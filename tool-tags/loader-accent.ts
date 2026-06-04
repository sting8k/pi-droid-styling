export type WorkingLoaderState = "working" | "thinking" | "answering" | "running";

export interface WorkingLoaderTheme {
	fg?(color: string, text: string): string;
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

export const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
export const SPINNER_INTERVAL_MS = 80;
export const WORKING_MESSAGE_INTERVAL_MS = 400;

const WORKING_SPINNER_COLORS = ["accent", "mdLink", "bashMode", "success", "toolTitle", "mdLink"];
const WORKING_STATE_LABELS: Record<WorkingLoaderState, string> = {
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

function dotsForStep(step: number): string {
	return ".".repeat((Math.max(0, Math.floor(step)) % 3) + 1);
}

function colorForStep(step: number): string {
	const frameIndex = Math.max(0, Math.floor(step)) % SPINNER_FRAMES.length;
	return WORKING_SPINNER_COLORS[frameIndex % WORKING_SPINNER_COLORS.length] ?? "accent";
}
export function renderWorkingMessage(state: WorkingLoaderState, step: number, theme?: WorkingLoaderTheme): string {
	return themeFg(theme, "accent", `${WORKING_STATE_LABELS[state]}${dotsForStep(step)}`);
}

export function createWorkingIndicatorFrames(theme?: WorkingLoaderTheme): string[] {
	return SPINNER_FRAMES.map((frame, index) => themeFg(theme, colorForStep(index), frame));
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

export function createWorkingLoaderController(ui: WorkingLoaderUi): WorkingLoaderController {
	let state: WorkingLoaderState = "working";
	let step = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	const render = () => {
		ui.setWorkingMessage(renderWorkingMessage(state, step, ui.theme));
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
