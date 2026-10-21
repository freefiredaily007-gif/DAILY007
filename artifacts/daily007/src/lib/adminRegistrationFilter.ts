export type AdminRegistrationFilterRow = {
  status?: string | null;
  tournamentId?: string | number | null;
};

export function filterAdminRegistrationRows<T extends AdminRegistrationFilterRow>(
  rows: readonly T[],
  status: string,
  tournamentId: string,
): T[] {
  const selectedTournamentId = String(tournamentId ?? '').trim();
  return rows.filter((row) =>
    row.status === status &&
    (!selectedTournamentId || String(row.tournamentId ?? '') === selectedTournamentId)
  );
}
