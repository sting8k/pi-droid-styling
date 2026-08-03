import { DEFAULT_PRESENTATION_STYLE, type PresentationStyleName } from "./designs.js";

let activePresentationStyle: PresentationStyleName = DEFAULT_PRESENTATION_STYLE;

export function setPresentationStyle(style: PresentationStyleName): void {
	activePresentationStyle = style;
}

export function getPresentationStyle(): PresentationStyleName {
	return activePresentationStyle;
}

