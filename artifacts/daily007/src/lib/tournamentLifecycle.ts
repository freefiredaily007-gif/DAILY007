export type TournamentLifecycleState = 'upcoming' | 'ongoing' | 'completed' | 'closed';

export const MAX_TIMEOUT_MS = 2_147_000_000;

export function compareTournamentStartTime(a: any, b: any): number {
  const aStart = Date.parse(String(a?.startsAt ?? ''));
  const bStart = Date.parse(String(b?.startsAt ?? ''));
  const aValid = Number.isFinite(aStart);
  const bValid = Number.isFinite(bStart);
  if (aValid && bValid) return aStart - bStart;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

export function getTournamentLifecycleState(tournament: any, now = Date.now()): TournamentLifecycleState {
  const status = String(tournament?.status ?? '').toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'closed';
  if (status === 'ongoing' || status === 'live') return 'ongoing';

  const startsAt = Date.parse(String(tournament?.startsAt ?? ''));
  if (Number.isFinite(startsAt) && startsAt <= now) return 'ongoing';
  if (status === 'closed' || tournament?.enabled === false) return 'closed';
  return 'upcoming';
}