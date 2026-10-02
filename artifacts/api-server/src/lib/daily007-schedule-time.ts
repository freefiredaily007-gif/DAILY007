const IST_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;

/**
 * Legacy tournament rows store the entered India wall-clock time in a UTC
 * timestamp. Convert that stored wall time into the real instant in IST.
 */
export function tournamentInstantFromStored(value: Date | string): Date {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return new Date(timestamp - IST_OFFSET_MS);
}

/**
 * Convert an actual instant (for example an ISO timestamp sent by the v2 API)
 * to the legacy UTC-encoded India wall-clock value used by tournament rows.
 */
export function storedTournamentTimeFromInstant(value: Date): Date {
  return new Date(value.getTime() + IST_OFFSET_MS);
}

export function isTournamentStartInFuture(value: Date | string, now = Date.now()): boolean {
  return tournamentInstantFromStored(value).getTime() > now;
}