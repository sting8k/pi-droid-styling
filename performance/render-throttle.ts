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

/** Default frame interval in ms (29ms ~ 35fps) */
const DEFAULT_FRAME_MS = 29;

export function installRenderThrottle(tui: any, frameMs: number = DEFAULT_FRAME_MS): void {
	if (tui[PATCHED]) return;
	tui[PATCHED] = true;

	const origRequestRender = tui.requestRender.bind(tui);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastRenderTime = 0;
	let pendingForce = false;

	tui.requestRender = function throttledRequestRender(force = false) {
		profileCount("render.request.calls");
		if (force) {
			pendingForce = true;
			profileCount("render.request.force");
		}

		// Already scheduled
		if (timer !== null) {
			profileCount("render.request.coalesced");
			return;
		}

		const now = Date.now();
		const elapsed = now - lastRenderTime;

		if (elapsed >= frameMs) {
			// Enough time passed — render immediately
			profileCount("render.request.dispatch.immediate");
			profileSample("render.request.latency.ms", 0);
			lastRenderTime = now;
			origRequestRender(pendingForce);
			pendingForce = false;
		} else {
			// Schedule render for remaining time
			const delay = frameMs - elapsed;
			const scheduledAt = profileNow();
			profileCount("render.request.scheduled");
			profileSample("render.request.delay.ms", delay);
			timer = setTimeout(() => {
				timer = null;
				lastRenderTime = Date.now();
				profileCount("render.request.dispatch.delayed");
				profileDuration("render.request.latency.ms", scheduledAt);
				origRequestRender(pendingForce);
				pendingForce = false;
			}, delay);
		}
	};
}
