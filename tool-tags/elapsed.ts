import type { AgentToolResult } from "@mariozechner/pi-coding-agent";

const ELAPSED_KEY = "__elapsedMs";

export function formatElapsed(result: AgentToolResult<any> | undefined): string {
	const ms = (result?.details as any)?.[ELAPSED_KEY];
	if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
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
		}
		return result;
	}) as T;
}
