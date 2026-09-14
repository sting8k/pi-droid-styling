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

export function annotateToolResultMetrics(result: AgentToolResult<any> | undefined, elapsedMs?: number): void {
	if (!result || typeof result !== "object") return;
	if (!result.details || typeof result.details !== "object") {
		(result as any).details = {};
	}
	const details = result.details as any;
	const existingElapsed = details[ELAPSED_KEY];
	if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && (typeof existingElapsed !== "number" || !Number.isFinite(existingElapsed))) {
		details[ELAPSED_KEY] = elapsedMs;
	}
	if (typeof details[OUTPUT_CHARS_KEY] !== "number" || !Number.isFinite(details[OUTPUT_CHARS_KEY])) {
		details[OUTPUT_CHARS_KEY] = getTextOutputLength(result);
	}
}

export function wrapExecuteWithTiming<T extends (...args: any[]) => Promise<AgentToolResult<any>>>(
	executeFn: T,
): T {
	return (async (...args: any[]) => {
		const start = performance.now();
		const result = await executeFn(...args);
		annotateToolResultMetrics(result, performance.now() - start);
		return result;
	}) as T;
}

/**
 * Component-state timing for decorated renderers.
 *
 * Renderers attached via ToolExecutionComponent patches have no execute wrapper,
 * so wall time comes from three sources, in order:
 * 1. frozen state value (first result render freezes it for the component lifetime),
 * 2. tool_execution_start/end events recorded by index.ts (current session run),
 * 3. result.details.__elapsedMs (providers that annotate results themselves).
 */
const STATE_STARTED_AT_KEY = "__droidStartedAt";
const STATE_ELAPSED_KEY = "__droidElapsedMs";

const toolCallStartAt = new Map<string, number>();
const toolCallElapsedById = new Map<string, number>();
const TIMING_CACHE_LIMIT = 512;

function evictOldest(map: Map<string, number>): void {
	while (map.size > TIMING_CACHE_LIMIT) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

export function recordToolCallTimingStart(toolCallId: string | undefined): void {
	if (!toolCallId) return;
	toolCallStartAt.set(toolCallId, performance.now());
	evictOldest(toolCallStartAt);
}

export function recordToolCallTimingEnd(toolCallId: string | undefined): void {
	if (!toolCallId) return;
	const start = toolCallStartAt.get(toolCallId);
	if (start === undefined) return;
	const elapsed = performance.now() - start;
	toolCallStartAt.delete(toolCallId);
	toolCallElapsedById.set(toolCallId, elapsed);
	evictOldest(toolCallElapsedById);
}

/**
 * Stamp the start time into renderer state once execution has begun, so elapsed
 * can be derived even without event records (e.g. components created mid-run).
 */
export function markToolCallExecutionStarted(context: { executionStarted?: boolean; state?: Record<string, unknown> } | undefined): void {
	const state = context?.state;
	if (!context?.executionStarted || !state || typeof state !== "object") return;
	if (typeof state[STATE_STARTED_AT_KEY] === "number") return;
	state[STATE_STARTED_AT_KEY] = performance.now();
}

export function resolveToolCallElapsedMs(
	context: { state?: Record<string, unknown>; toolCallId?: string } | undefined,
	result: AgentToolResult<any> | undefined,
): number | undefined {
	const state = context?.state;
	if (state && typeof state === "object") {
		const frozen = state[STATE_ELAPSED_KEY];
		if (typeof frozen === "number" && Number.isFinite(frozen)) return frozen;
	}
	const byId = typeof context?.toolCallId === "string" ? toolCallElapsedById.get(context.toolCallId) : undefined;
	const resolved = byId ?? getElapsedMs(result);
	if (Number.isFinite(resolved) && state && typeof state === "object") {
		state[STATE_ELAPSED_KEY] = resolved;
	}
	return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : undefined;
}
