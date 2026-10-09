import { REASONIX_MARKER_GAP } from "./reasonix-layout.js";

export const PRESENTATION_STYLE_NAMES = ["droid", "reasonix", "claudecode"] as const;

export type PresentationStyleName = (typeof PRESENTATION_STYLE_NAMES)[number];

type PresentationStyleNameSet = Record<PresentationStyleName, true>;

const PRESENTATION_STYLE_NAME_SET: PresentationStyleNameSet = {
	droid: true,
	reasonix: true,
	claudecode: true,
};

export type PresentationDesign = {
	name: PresentationStyleName;
	compactLayout: boolean;
	markerGap: string;
	stripsBackground: boolean;
	/** Collapsed tool-call row look inside the compact layout. */
	toolCallStyle: "box" | "reasonix" | "claudecode";
};

export const DEFAULT_PRESENTATION_STYLE: PresentationStyleName = "droid";

const PRESENTATION_DESIGNS: Record<PresentationStyleName, PresentationDesign> = {
	droid: { name: "droid", compactLayout: false, markerGap: "  ", stripsBackground: false, toolCallStyle: "box" },
	reasonix: { name: "reasonix", compactLayout: true, markerGap: REASONIX_MARKER_GAP, stripsBackground: true, toolCallStyle: "reasonix" },
	// Reasonix conversation layout with Claude Code-style tool rows: `● Name(args)` + `  └ result`.
	claudecode: { name: "claudecode", compactLayout: true, markerGap: REASONIX_MARKER_GAP, stripsBackground: true, toolCallStyle: "claudecode" },
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
