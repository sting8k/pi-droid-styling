import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

const ELAPSED_KEY = "__elapsedMs";
const OUTPUT_CHARS_KEY = "__outputChars";

function getTextOutputLength(result: AgentToolResult<any>): number {
	if (!Array.isArray(result.content)) return 0;
	let length = 0;
	let seenText = false;
	for (const contentBlock of result.content as any[]) {
		if (contentBlock?.type !== "text") continue;
		if (seenText) length += 1; // matches getTextOutput() joining text blocks with newlines
		length += String(contentBlock.text ?? "").replace(/\r/g, "").length;
		seenText = true;
	}
	return length;
}

function formatCompactCount(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
	return `${Math.round(value / 1000000)}M`;
}

export function formatElapsedMs(ms: number | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function formatOutputChars(chars: number | undefined): string {
	if (typeof chars !== "number" || !Number.isFinite(chars) || chars <= 0) return "";
	return `${formatCompactCount(chars)} ${chars === 1 ? "char" : "chars"}`;
}

export function formatToolMetricsFromValues(elapsedMs: number | undefined, outputChars: number | undefined): string {
	return [formatElapsedMs(elapsedMs), formatOutputChars(outputChars)].filter(Boolean).join(" · ");
}

export function getElapsedMs(result: AgentToolResult<any> | undefined): number | undefined {
	const elapsed = (result?.details as any)?.[ELAPSED_KEY];
	return typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : undefined;
}

export function formatElapsed(result: AgentToolResult<any> | undefined): string {
	return formatElapsedMs(getElapsedMs(result));
}

export function formatOutputSize(result: AgentToolResult<any> | undefined): string {
	return formatOutputChars((result?.details as any)?.[OUTPUT_CHARS_KEY]);
}

export function formatToolMetrics(result: AgentToolResult<any> | undefined): string {
	return [formatElapsed(result), formatOutputSize(result)].filter(Boolean).join(" · ");
}

export function wrapExecuteWithTiming<T extends (...args: any[]) => Promise<AgentToolResult<any>>>(
	executeFn: T,
): T {
	return (async (...args: any[]) => {
		const start = performance.now();
		const result = await executeFn(...args);
		const elapsed = performance.now() - start;
		if (result && typeof result === "object") {
			if (!result.details || typeof result.details !== "object") {
				(result as any).details = {};
			}
			(result.details as any)[ELAPSED_KEY] = elapsed;
			(result.details as any)[OUTPUT_CHARS_KEY] = getTextOutputLength(result);
		}
		return result;
	}) as T;
}
