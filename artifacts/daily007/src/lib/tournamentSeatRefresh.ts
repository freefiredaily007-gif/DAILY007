export const TOURNAMENT_SEAT_REFRESH_INTERVAL_MS = 15_000;

const CLOSED_SEAT_STATUSES = new Set([
  'cancelled',
  'closed',
  'completed',
  'full',
  'live',
  'ongoing',
  'setup_needed',
]);

export function getTournamentSeatRefreshInterval(
  isFocused: boolean,
  isAppActive: boolean,
  status: unknown,
): number | false {
  if (!isFocused || !isAppActive) return false;
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return CLOSED_SEAT_STATUSES.has(normalizedStatus)
    ? false
    : TOURNAMENT_SEAT_REFRESH_INTERVAL_MS;
}
