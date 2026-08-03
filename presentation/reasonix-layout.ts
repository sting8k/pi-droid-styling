export const REASONIX_MARKER_GAP = " ";

const REASONIX_COLLAPSED_MIN_WIDTH = 40;
const REASONIX_COLLAPSED_WIDTH_RATIO = 0.8;

export function getReasonixCollapsedRowWidth(width: number): number {
	const availableWidth = Math.max(1, Math.floor(width));
	if (availableWidth <= REASONIX_COLLAPSED_MIN_WIDTH) return availableWidth;
	return Math.floor(availableWidth * REASONIX_COLLAPSED_WIDTH_RATIO);
}
