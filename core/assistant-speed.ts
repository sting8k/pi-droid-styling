export interface AssistantSpeedTracker {
	handleMessageStart(message: any): void;
	handleMessageUpdate(message: any): void;
	handleMessageEnd(message: any): void;
	resetSession(): void;
	getWordsPerSecond(): number | null;
}

const SPEED_UPDATE_INTERVAL_MS = 5000;

function countWords(text: string): number {
	return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

function countTextWords(message: any): number {
	const content = message?.content;
	if (!Array.isArray(content)) return 0;
	return content.reduce((sum, block) => {
		if (block?.type !== "text" || typeof block.text !== "string") return sum;
		return sum + countWords(block.text);
	}, 0);
}

function computeSpeed(words: number, startMs: number, endMs = Date.now()): number {
	const elapsedSeconds = Math.max(0.001, (endMs - startMs) / 1000);
	return words / elapsedSeconds;
}

function normalizeSpeed(wordsPerSecond: number): number {
	return wordsPerSecond >= 100 ? Math.round(wordsPerSecond) : Math.round(wordsPerSecond * 10) / 10;
}

export function createAssistantSpeedTracker(): AssistantSpeedTracker {
	let assistantResponseStartMs: number | null = null;
	let assistantTextStartMs: number | null = null;
	let assistantLastTextMs: number | null = null;
	let currentAssistantWordsPerSecond: number | null = null;
	let lastAssistantWordsPerSecond: number | null = null;
	let lastAssistantWordCount = 0;
	let lastSpeedUpdateMs = 0;

	function resetCurrentMessage(): void {
		assistantResponseStartMs = null;
		assistantTextStartMs = null;
		assistantLastTextMs = null;
		currentAssistantWordsPerSecond = null;
		lastAssistantWordCount = 0;
		lastSpeedUpdateMs = 0;
	}

	return {
		handleMessageStart(message: any): void {
			if (message.role !== "assistant") return;
			assistantResponseStartMs = Date.now();
			assistantTextStartMs = null;
			assistantLastTextMs = null;
			currentAssistantWordsPerSecond = null;
			lastAssistantWordCount = 0;
			lastSpeedUpdateMs = 0;
		},

		handleMessageUpdate(message: any): void {
			if (message.role !== "assistant") return;
			if (!assistantResponseStartMs) return;
			const words = countTextWords(message);
			if (words <= 0) return;
			const now = Date.now();
			if (assistantTextStartMs === null) {
				assistantTextStartMs = now;
				assistantLastTextMs = now;
				lastAssistantWordCount = words;
				lastSpeedUpdateMs = now;
				return;
			}
			if (words <= lastAssistantWordCount) return;
			assistantLastTextMs = now;
			lastAssistantWordCount = words;
			if (now - lastSpeedUpdateMs < SPEED_UPDATE_INTERVAL_MS) return;
			lastSpeedUpdateMs = now;
			const nextSpeed = computeSpeed(words, assistantTextStartMs, assistantLastTextMs);
			const normalizedSpeed = normalizeSpeed(nextSpeed);
			if (currentAssistantWordsPerSecond !== normalizedSpeed) {
				currentAssistantWordsPerSecond = normalizedSpeed;
			}
		},

		handleMessageEnd(message: any): void {
			if (message.role !== "assistant") return;
			const startedAt = assistantTextStartMs ?? assistantResponseStartMs;
			const endedAt = assistantLastTextMs ?? Date.now();
			resetCurrentMessage();
			if (!startedAt) return;
			const words = countTextWords(message);
			if (words <= 0) return;
			lastAssistantWordsPerSecond = computeSpeed(words, startedAt, endedAt);
		},

		resetSession(): void {
			resetCurrentMessage();
			lastAssistantWordsPerSecond = null;
		},

		getWordsPerSecond(): number | null {
			return currentAssistantWordsPerSecond ?? lastAssistantWordsPerSecond;
		},
	};
}
