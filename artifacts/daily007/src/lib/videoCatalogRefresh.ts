export const VIDEO_CATALOG_REFRESH_INTERVAL_MS = 60_000;

type VideoCatalogRefreshState = {
  isFocused: boolean;
  isAppActive: boolean;
  isPlayerOpen: boolean;
};

export function getVideoCatalogRefreshInterval(
  { isFocused, isAppActive, isPlayerOpen }: VideoCatalogRefreshState,
  intervalMs = VIDEO_CATALOG_REFRESH_INTERVAL_MS,
): number | false {
  return isFocused && isAppActive && !isPlayerOpen ? intervalMs : false;
}
