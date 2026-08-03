import { DEFAULT_PRESENTATION_STYLE, isPresentationStyleName, type PresentationStyleName } from "./designs.js";

const ACTIVE_PRESENTATION_STYLE = Symbol.for("pi-droid-styling.presentation.active-style");
const runtimeState = globalThis as Record<PropertyKey, unknown>;

export function setPresentationStyle(style: PresentationStyleName): void {
	runtimeState[ACTIVE_PRESENTATION_STYLE] = style;
}

export function getPresentationStyle(): PresentationStyleName {
	const style = runtimeState[ACTIVE_PRESENTATION_STYLE];
	return isPresentationStyleName(style) ? style : DEFAULT_PRESENTATION_STYLE;
}

