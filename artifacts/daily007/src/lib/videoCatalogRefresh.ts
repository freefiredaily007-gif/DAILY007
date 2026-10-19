export const VIDEO_CATALOG_REFRESH_INTERVAL_MS = 60_000;

type VideoCatalogRefreshState = {
  isFocused: boolean;
  isAppActive: boolean;
  isPlayerOpen: boolean;
};

export function shouldRefreshVideoCatalogOnFocus({
  isFocused,
  isAppActive,
  isPlayerOpen,
}: VideoCatalogRefreshState): boolean {
  return isFocused && isAppActive && !isPlayerOpen;
}

export function getVideoCatalogRefreshInterval(
  state: VideoCatalogRefreshState,
  intervalMs = VIDEO_CATALOG_REFRESH_INTERVAL_MS,
): number | false {
  return shouldRefreshVideoCatalogOnFocus(state) ? intervalMs : false;
}

export function shouldPreserveVideoCatalogScroll({
  isFetching,
  isPlayerOpen,
  scrollOffset,
}: {
  isFetching: boolean;
  isPlayerOpen: boolean;
  scrollOffset: number;
}): boolean {
  return isFetching && !isPlayerOpen && scrollOffset > 0;
}
