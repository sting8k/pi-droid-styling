/**
 * Throttle TUI rendering to a target frame rate.
 *
 * Pi's default `requestRender` fires on every `process.nextTick`, which can
 * cause excessive renders during fast streaming. This patches the TUI instance
 * to batch renders into fixed intervals (default 16ms ≈ 60fps).
 *
 * Typing input triggers an immediate render (no delay) for responsiveness.
 */

const PATCHED = Symbol("render-throttle");

/** Default frame interval in ms (16ms ~ 60fps) */
const DEFAULT_FRAME_MS = 16;

export function installRenderThrottle(tui: any, frameMs: number = DEFAULT_FRAME_MS): void {
	if (tui[PATCHED]) return;
	tui[PATCHED] = true;

	const origRequestRender = tui.requestRender.bind(tui);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastRenderTime = 0;
	let pendingForce = false;

	tui.requestRender = function throttledRequestRender(force = false) {
		if (force) pendingForce = true;

		// Already scheduled
		if (timer !== null) return;

		const now = Date.now();
		const elapsed = now - lastRenderTime;

		if (elapsed >= frameMs) {
			// Enough time passed — render immediately
			lastRenderTime = now;
			origRequestRender(pendingForce);
			pendingForce = false;
		} else {
			// Schedule render for remaining time
			const delay = frameMs - elapsed;
			timer = setTimeout(() => {
				timer = null;
				lastRenderTime = Date.now();
				origRequestRender(pendingForce);
				pendingForce = false;
			}, delay);
		}
	};
}
