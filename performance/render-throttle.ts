/**
 * Throttle TUI rendering to a target frame rate.
 *
 * Pi's default `requestRender` fires on every `process.nextTick`, which can
 * cause excessive renders during fast streaming. This patches the TUI instance
 * to batch renders into fixed intervals (default 29ms ≈ 35fps).
 *
 * Typing input triggers an immediate render (no delay) for responsiveness.
 */

import { profileCount, profileDuration, profileNow, profileSample } from "./profiler.js";

const PATCHED = Symbol.for("pi-droid-styling.render-throttle.patched");
const REQUEST_WITH_FRAME_MS = Symbol.for("pi-droid-styling.render-throttle.request-with-frame-ms");

/** Default frame interval in ms (29ms ~ 35fps) */
const DEFAULT_FRAME_MS = 29;

function normalizeFrameMs(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value < 0) return fallback;
	return Math.floor(value);
}

export function requestRenderWithFrameMs(tui: any, frameMs: number, force = false): void {
	const requester = tui?.[REQUEST_WITH_FRAME_MS];
	if (typeof requester === "function") {
		requester(frameMs, force);
		return;
	}
	if (typeof tui?.requestRender === "function") tui.requestRender(force);
}

export function installRenderThrottle(tui: any, frameMs: number = DEFAULT_FRAME_MS): void {
	if (tui[PATCHED]) {
		if (typeof tui[REQUEST_WITH_FRAME_MS] !== "function") {
			tui[REQUEST_WITH_FRAME_MS] = (requestedFrameMs: number, force = false) => tui.requestRender(force);
		}
		return;
	}
	tui[PATCHED] = true;

	const origRequestRender = tui.requestRender.bind(tui);
	const defaultFrameMs = normalizeFrameMs(frameMs, DEFAULT_FRAME_MS);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let timerDueAt = 0;
	let lastRenderTime = 0;
	let pendingForce = false;

	function clearScheduledRender(): void {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
		timerDueAt = 0;
	}

	function dispatchRender(now: number): void {
		clearScheduledRender();
		lastRenderTime = now;
		origRequestRender(pendingForce);
		pendingForce = false;
	}

	function scheduleRender(delay: number): void {
		const scheduledAt = profileNow();
		timerDueAt = Date.now() + delay;
		timer = setTimeout(() => {
			timer = null;
			timerDueAt = 0;
			lastRenderTime = Date.now();
			profileCount("render.request.dispatch.delayed");
			profileDuration("render.request.latency.ms", scheduledAt);
			origRequestRender(pendingForce);
			pendingForce = false;
		}, delay);
	}

	function requestRenderAtFrame(force = false, requestedFrameMs = defaultFrameMs): void {
		profileCount("render.request.calls");
		if (force) {
			pendingForce = true;
			profileCount("render.request.force");
		}

		const effectiveFrameMs = normalizeFrameMs(requestedFrameMs, defaultFrameMs);
		const now = Date.now();
		const elapsed = now - lastRenderTime;

		if (elapsed >= effectiveFrameMs) {
			// Enough time passed — render immediately
			profileCount("render.request.dispatch.immediate");
			profileSample("render.request.latency.ms", 0);
			dispatchRender(now);
			return;
		}

		const delay = effectiveFrameMs - elapsed;
		const dueAt = now + delay;
		if (timer !== null) {
			if (dueAt < timerDueAt) {
				profileCount("render.request.rescheduledEarlier");
				profileSample("render.request.delay.ms", delay);
				clearScheduledRender();
				scheduleRender(delay);
			} else {
				profileCount("render.request.coalesced");
			}
			return;
		}

		// Schedule render for remaining time
		profileCount("render.request.scheduled");
		profileSample("render.request.delay.ms", delay);
		scheduleRender(delay);
	}

	tui[REQUEST_WITH_FRAME_MS] = (requestedFrameMs: number, force = false) => requestRenderAtFrame(force, requestedFrameMs);
	tui.requestRender = function throttledRequestRender(force = false) {
		requestRenderAtFrame(force, defaultFrameMs);
	};
}
