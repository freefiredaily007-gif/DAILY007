export type TournamentCapacitySnapshot = {
  filledPlayers: number;
  totalPlayers: number;
  filledSlots: number;
  totalSlots: number;
  status?: string | null;
};

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
