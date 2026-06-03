/**
 * Debounce ToolExecutionComponent.updateResult() for partial tool output.
 *
 * Why:
 * - interactive-mode calls `component.updateResult(..., true)` on every
 *   `tool_execution_update`, then calls `ui.requestRender()`.
 * - ToolExecutionComponent.updateResult() triggers updateDisplay(), which clears
 *   and rebuilds renderer components every time. For noisy tools (bash/read),
 *   this can dominate CPU during long-running tasks.
 *
 * Strategy:
 * - Coalesce partial updates into fixed windows (default 80ms).
 * - Final update (`isPartial=false`) always flushes immediately.
 * - After a debounced flush, request one render so the latest chunk is visible.
 */

import { profileCount, profileDuration, profileNow } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.debounce-tool-updates.patched");

/** ~12.5Hz for heavy tool-output rebuilds */
const TOOL_PARTIAL_FLUSH_MS = 80;

const TIMER_KEY = Symbol("tool-update-timer");
const PENDING_KEY = Symbol("tool-update-pending");

export function installToolExecutionUpdateDebounce(ToolExecutionClass: any): void {
	const proto = ToolExecutionClass?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;

	const orig = proto.updateResult;
	if (typeof orig !== "function") return;

	proto.updateResult = function patchedUpdateResult(result: any, isPartial: boolean = false) {
		profileCount("tool.updateResult.calls");
		if (!isPartial) {
			profileCount("tool.updateResult.final");
			const t = (this as any)[TIMER_KEY];
			if (t) {
				clearTimeout(t);
				(this as any)[TIMER_KEY] = null;
				profileCount("tool.updateResult.cancelPending");
			}
			(this as any)[PENDING_KEY] = null;
			const start = profileNow();
			try {
				return orig.call(this, result, false);
			} finally {
				profileDuration("tool.updateResult.ms", start);
			}
		}

		profileCount("tool.updateResult.partial");
		(this as any)[PENDING_KEY] = result;
		if ((this as any)[TIMER_KEY]) {
			profileCount("tool.updateResult.coalesced");
			return;
		}

		profileCount("tool.updateResult.scheduled");
		(this as any)[TIMER_KEY] = setTimeout(() => {
			(this as any)[TIMER_KEY] = null;
			const pending = (this as any)[PENDING_KEY];
			(this as any)[PENDING_KEY] = null;
			if (!pending) return;
			profileCount("tool.updateResult.flush");
			const start = profileNow();
			try {
				orig.call(this, pending, true);
			} finally {
				profileDuration("tool.updateResult.ms", start);
			}
			try {
				(this as any).ui?.requestRender?.();
				profileCount("tool.updateResult.flushRequestRender");
			} catch {
				// best effort only
			}
		}, TOOL_PARTIAL_FLUSH_MS);
	};
}
