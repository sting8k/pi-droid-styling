import { TerminalSplitCompositor, type TerminalSplitOptions } from "./terminal-split.js";
import { type HiddenRenderable, type RenderableLike } from "./cluster.js";

interface TuiLike extends RenderableLike {
	children?: unknown[];
	requestRender(force?: boolean): void;
	terminal: {
		write(data: string): void;
		columns: number;
		rows: number;
	};
}

interface SessionUiLike {
	onTerminalInput?: (handler: (data: string) => { consume?: boolean; data?: string } | undefined) => () => void;
}

export interface FixedUserZoneInstallOptions extends TerminalSplitOptions {
	enabled: boolean;
}

interface FixedUserZoneState {
	compositor: TerminalSplitCompositor;
	restoreHiddenRenderables(): void;
	unsubscribeInput?: () => void;
	dispose(): void;
}

const STATE = Symbol.for("pi-droid-styling.fixed-user-zone.state");
const FIXED_ZONE_CHILD_INDEXES = [3, 4, 5, 6, 7] as const;

function isRenderable(value: unknown): value is RenderableLike {
	return !!value && typeof (value as RenderableLike).render === "function";
}

function collectFixedZoneRenderables(tui: TuiLike): RenderableLike[] {
	const children = Array.isArray(tui.children) ? tui.children : [];
	const renderables: RenderableLike[] = [];
	const seen = new Set<RenderableLike>();
	for (const index of FIXED_ZONE_CHILD_INDEXES) {
		const child = children[index];
		if (!isRenderable(child) || seen.has(child)) continue;
		seen.add(child);
		renderables.push(child);
	}
	return renderables;
}

function hideRenderables(renderables: RenderableLike[]): { hidden: HiddenRenderable[]; restore(): void } {
	const hidden: HiddenRenderable[] = renderables.map((target) => {
		const originalRender = target.render.bind(target);
		target.render = () => [];
		return {
			target,
			render: originalRender,
		};
	});
	return {
		hidden,
		restore() {
			for (const renderable of hidden) {
				renderable.target.render = renderable.render;
			}
		},
	};
}

export function installFixedUserZone(
	sessionUi: SessionUiLike,
	tui: TuiLike,
	options: FixedUserZoneInstallOptions,
): (() => void) | undefined {
	if (!options.enabled) return undefined;
	const host = tui as TuiLike & { [STATE]?: FixedUserZoneState };
	if (host[STATE]) return () => host[STATE]?.dispose();

	const { hidden, restore } = hideRenderables(collectFixedZoneRenderables(tui));
	if (hidden.length === 0) {
		restore();
		return undefined;
	}

	const compositor = new TerminalSplitCompositor(tui, hidden, { mouseScroll: options.mouseScroll });
	let disposed = false;
	const state: FixedUserZoneState = {
		compositor,
		restoreHiddenRenderables: restore,
		dispose() {
			if (disposed) return;
			disposed = true;
			state.unsubscribeInput?.();
			state.restoreHiddenRenderables();
			state.compositor.dispose();
			delete host[STATE];
		},
	};
	host[STATE] = state;
	compositor.install();
	state.unsubscribeInput = sessionUi.onTerminalInput?.((data) => compositor.handleInput(data));
	return () => state.dispose();
}

export function disposeFixedUserZone(tui: unknown): void {
	const state = (tui as { [STATE]?: FixedUserZoneState } | undefined)?.[STATE];
	state?.dispose();
}
