import { REASONIX_MARKER_GAP } from "./reasonix-layout.js";

export const PRESENTATION_STYLE_NAMES = ["droid", "reasonix"] as const;

export type PresentationStyleName = (typeof PRESENTATION_STYLE_NAMES)[number];

type PresentationStyleNameSet = Record<PresentationStyleName, true>;

const PRESENTATION_STYLE_NAME_SET: PresentationStyleNameSet = {
	droid: true,
	reasonix: true,
};

export type PresentationDesign = {
	name: PresentationStyleName;
	compactLayout: boolean;
	markerGap: string;
	stripsBackground: boolean;
};

export const DEFAULT_PRESENTATION_STYLE: PresentationStyleName = "droid";

const PRESENTATION_DESIGNS: Record<PresentationStyleName, PresentationDesign> = {
	droid: { name: "droid", compactLayout: false, markerGap: "  ", stripsBackground: false },
	reasonix: { name: "reasonix", compactLayout: true, markerGap: REASONIX_MARKER_GAP, stripsBackground: true },
};

export function getPresentationDesignFor(style: PresentationStyleName): PresentationDesign {
	return PRESENTATION_DESIGNS[style];
}

export function isPresentationStyleName(value: unknown): value is PresentationStyleName {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESENTATION_STYLE_NAME_SET, value);
}

export function normalizePresentationStyleName(value: unknown): PresentationStyleName {
	return isPresentationStyleName(value) ? value : DEFAULT_PRESENTATION_STYLE;
}
