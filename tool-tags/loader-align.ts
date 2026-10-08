import { Loader } from "@earendil-works/pi-tui";
import { getPresentationDesign } from "../presentation/state.js";

const ORIGINAL_RENDER = Symbol.for("pi-droid-styling.loader-align.original-render");

type RenderFn = (this: unknown, width: number) => string[];

/**
 * Pi's status indicators (working, retry) are Loaders built on a Text with a
 * one-column left margin, so under the compact (reasonix) layout their glyph
 * sits one column right of the tool and assistant markers. Drop that margin
 * so `○` lines up with `◐`/`●`. Other Loaders (dialogs) and the droid layout
 * are untouched; the in-border render path only strips a leading space, so it
 * sees the same content either way.
 *
 * Installed on the prototype once per load: a reload rewraps the original
 * render instead of stacking wrappers, and the layout is read at render time.
 */
export function installWorkingLoaderAlignment(LoaderClass: any = Loader): void {
	const proto = LoaderClass?.prototype as any;
	if (!proto || typeof proto.render !== "function") return;
	const original: RenderFn = proto.render[ORIGINAL_RENDER] ?? proto.render;

	const render = function (this: { kind?: unknown }, width: number): string[] {
		const lines = original.call(this, width);
		if (typeof this.kind !== "string" || !getPresentationDesign().compactLayout) return lines;
		return lines.map((line) => (line.startsWith(" ") ? line.slice(1) : line));
	};
	(render as any)[ORIGINAL_RENDER] = original;
	proto.render = render;
}
