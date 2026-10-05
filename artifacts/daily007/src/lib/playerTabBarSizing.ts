const BASE_TAB_BAR_HEIGHT = 65;
const EXTRA_HEIGHT_PER_FONT_SCALE = 32;
const NARROW_LARGE_TEXT_TAB_BAR_HEIGHT = 148;

export function getPlayerTabBarHeight(fontScale: number | undefined, screenWidth?: number) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale as number) : 1;
  const scaledHeight = Math.ceil(BASE_TAB_BAR_HEIGHT + (scale - 1) * EXTRA_HEIGHT_PER_FONT_SCALE);
  return screenWidth !== undefined && screenWidth <= 340 && scale >= 1.5
    ? Math.max(scaledHeight, NARROW_LARGE_TEXT_TAB_BAR_HEIGHT)
    : scaledHeight;
}