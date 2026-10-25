export type TournamentCapacitySnapshot = {
  filledPlayers: number;
  totalPlayers: number;
  filledSlots: number;
  totalSlots: number;
  status?: string | null;
};

export function getTournamentFilledPlayerCount(capacity: {
  filledSlots: number;
  teamSize: number;
  filledPlayerSlots?: unknown;
  individualPlayerSlots: boolean;
}): number {
  const filledSlots = Math.max(0, Number(capacity.filledSlots) || 0);

  // Solo formats use one registration per seat. Do not multiply those seats
  // by stale team-size metadata or trust a mismatched player counter.
  if (capacity.individualPlayerSlots) return filledSlots;

  const reportedPlayers = Number(capacity.filledPlayerSlots);
  if (
    capacity.filledPlayerSlots !== undefined &&
    capacity.filledPlayerSlots !== null &&
    Number.isFinite(reportedPlayers) &&
    reportedPlayers >= 0
  ) {
    return reportedPlayers;
  }

  return filledSlots * Math.max(1, Number(capacity.teamSize) || 1);
}

export function isTournamentCapacityFull(capacity: TournamentCapacitySnapshot): boolean {
  const status = String(capacity.status ?? '').toLowerCase();

  // Player counts are authoritative, even when every team has been opened or
  // an old match status still says full/setup_needed.
  if (
    Number.isFinite(capacity.filledPlayers) &&
    Number.isFinite(capacity.totalPlayers) &&
    capacity.totalPlayers > 0
  ) {
    return capacity.filledPlayers >= capacity.totalPlayers;
  }

  return status === 'full' ||
    status === 'setup_needed' ||
    (capacity.totalSlots > 0 && capacity.filledSlots >= capacity.totalSlots);
}
