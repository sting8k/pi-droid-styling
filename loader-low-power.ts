/**
 * Reduce idle CPU while waiting for agent/tool completion by slowing
 * Loader spinner animation to a capped FPS.
 *
 * Core `Loader` defaults to 80ms (~12.5fps) and calls `ui.requestRender()`
 * each tick. In large chats this can keep CPU high while waiting.
 *
 * Strategy:
 * - Keep spinner animation (better UX than fully static).
 * - Cap animation speed to ECO_FPS.
 * - Preserve normal behavior for setMessage()/state updates.
 */

import { Loader } from "@mariozechner/pi-tui";

const PATCHED = Symbol("loader-low-power");
const ECO_FPS = 3;
const ECO_INTERVAL_MS = Math.ceil(1000 / ECO_FPS);

export function installLoaderLowPowerMode(): void {
	const proto = (Loader as any)?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;

	proto.restartAnimation = function patchedRestartAnimation() {
		if (typeof this.stop === "function") {
			this.stop();
		}

		if (!Array.isArray(this.frames) || this.frames.length <= 1) {
			return;
		}

		const interval = Math.max(Number(this.intervalMs) || ECO_INTERVAL_MS, ECO_INTERVAL_MS);
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			if (typeof this.updateDisplay === "function") {
				this.updateDisplay();
			}
		}, interval);
	};
}
