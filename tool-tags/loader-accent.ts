import { Loader } from "@mariozechner/pi-tui";

const PATCH_FLAG = "__loaderAccentPatched__";
const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
const SPINNER_INTERVAL = 40;

export function installLoaderAccent(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = Loader.prototype as any;
	if (!proto || typeof proto.start !== "function") return;

	const baseStart = proto.start;
	proto.start = function patchedLoaderStart(this: any, ...args: any[]) {
		this.frames = SPINNER_FRAMES;
		this.messageColorFn = this.spinnerColorFn;
		baseStart.apply(this, args);
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = setInterval(() => {
				this.currentFrame = (this.currentFrame + 1) % this.frames.length;
				this.updateDisplay();
			}, SPINNER_INTERVAL);
		}
	};
}
