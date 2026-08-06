import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./tui-proxy-original.js";

const PATCHED = Symbol.for("pi-droid-styling.render-autowrap-guard.patched");
const DISABLE_AUTOWRAP = "\x1b[?7l";
const ENABLE_AUTOWRAP = "\x1b[?7h";

type DoRenderFunction = (...args: unknown[]) => unknown;
type TerminalLike = { write?: (data: string) => void };

export function installRenderAutowrapGuard(tui: any): void {
	if (!tui || tui[PATCHED] || typeof tui.doRender !== "function") return;
	if (process.env.PI_DROID_RENDER_AUTOWRAP_GUARD !== "1") return;

	const originalDoRender = getOriginalTuiMethod(tui, "doRender") as DoRenderFunction;
	const terminal = tui.terminal as TerminalLike | undefined;
	const write = typeof terminal?.write === "function" ? terminal.write.bind(terminal) : undefined;
	if (!write) return;

	tui[PATCHED] = true;
	const guardedDoRender = function guardedDoRender(this: unknown, ...args: unknown[]): unknown {
		write(DISABLE_AUTOWRAP);
		try {
			return originalDoRender.call(this, ...args);
		} finally {
			write(ENABLE_AUTOWRAP);
		}
	};
	tui.doRender = guardedDoRender;
	rememberTuiMethodWrapper(tui, "doRender", guardedDoRender);
}
