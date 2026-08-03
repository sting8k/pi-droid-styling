const REASONIX_COLLAPSED_MIN_WIDTH = 40;
const REASONIX_COLLAPSED_MAX_WIDTH = 72;
const REASONIX_COLLAPSED_WIDTH_RATIO = 0.6;

export function getReasonixCollapsedRowWidth(width: number): number {
	const availableWidth = Math.max(1, Math.floor(width));
	if (availableWidth <= REASONIX_COLLAPSED_MIN_WIDTH) return availableWidth;
	return Math.min(
		REASONIX_COLLAPSED_MAX_WIDTH,
		Math.max(REASONIX_COLLAPSED_MIN_WIDTH, Math.floor(availableWidth * REASONIX_COLLAPSED_WIDTH_RATIO)),
	);
}
