export interface AssistantSpeedTracker {
	handleMessageStart(message: any): void;
	handleMessageUpdate(message: any): void;
	handleMessageEnd(message: any): void;
	resetSession(): void;
	getWordsPerSecond(): number | null;
}

const SPEED_UPDATE_INTERVAL_MS = 5000;
const MIN_SPEED_SAMPLE_MS = 150;

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

function computeSpeed(words: number, startMs: number, endMs = Date.now()): number | null {
	const elapsedMs = endMs - startMs;
	if (elapsedMs < MIN_SPEED_SAMPLE_MS) return null;
	return words / (elapsedMs / 1000);
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
			lastAssistantWordsPerSecond = null;
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
			const nextSpeed = computeSpeed(words, assistantTextStartMs, assistantLastTextMs);
			if (nextSpeed === null) return;
			const normalizedSpeed = normalizeSpeed(nextSpeed);
			if (now - lastSpeedUpdateMs < SPEED_UPDATE_INTERVAL_MS) return;
			lastSpeedUpdateMs = now;
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
			const finalSpeed = computeSpeed(words, startedAt, endedAt);
			if (finalSpeed === null) {
				lastAssistantWordsPerSecond = null;
				return;
			}
			lastAssistantWordsPerSecond = finalSpeed;
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
