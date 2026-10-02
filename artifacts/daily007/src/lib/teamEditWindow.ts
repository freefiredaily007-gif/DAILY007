export const TEAM_EDIT_LOCK_MS = 30 * 60 * 1000;

export function getTeamEditCutoff(startsAt: unknown): number | null {
  const startMs = startsAt instanceof Date
    ? startsAt.getTime()
    : typeof startsAt === 'number'
      ? startsAt
      : Date.parse(String(startsAt ?? ''));
  return Number.isFinite(startMs) ? startMs - TEAM_EDIT_LOCK_MS : null;
}

export function isTeamEditWindowOpen(startsAt: unknown, now = Date.now()): boolean {
  const cutoff = getTeamEditCutoff(startsAt);
  return cutoff !== null && now < cutoff;
}

export function canEditRegistrationTeam(
  tournament: any,
  registrationStatus: unknown,
  now = Date.now(),
): boolean {
  const status = String(registrationStatus ?? '').toLowerCase();
  const tournamentStatus = String(tournament?.status ?? '').toLowerCase();
  return ['approved', 'pending'].includes(status) &&
    tournament?.enabled !== false &&
    !['live', 'closed', 'cancelled', 'completed'].includes(tournamentStatus) &&
    isTeamEditWindowOpen(tournament?.startsAt, now);
}