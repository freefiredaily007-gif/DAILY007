const BASE_TAB_BAR_HEIGHT = 65;
const EXTRA_HEIGHT_PER_FONT_SCALE = 32;

export function getPlayerTabBarHeight(fontScale: number | undefined) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale as number) : 1;
  return Math.ceil(BASE_TAB_BAR_HEIGHT + (scale - 1) * EXTRA_HEIGHT_PER_FONT_SCALE);
}