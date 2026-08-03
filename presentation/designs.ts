export const PRESENTATION_STYLE_NAMES = ["droid", "reasonix"] as const;

export type PresentationStyleName = (typeof PRESENTATION_STYLE_NAMES)[number];

type PresentationStyleNameSet = Record<PresentationStyleName, true>;

const PRESENTATION_STYLE_NAME_SET: PresentationStyleNameSet = {
	droid: true,
	reasonix: true,
};

export const DEFAULT_PRESENTATION_STYLE: PresentationStyleName = "droid";

export function isPresentationStyleName(value: unknown): value is PresentationStyleName {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESENTATION_STYLE_NAME_SET, value);
}

export function normalizePresentationStyleName(value: unknown): PresentationStyleName {
	return isPresentationStyleName(value) ? value : DEFAULT_PRESENTATION_STYLE;
}
