export type TournamentLifecycleState = 'upcoming' | 'ongoing' | 'completed' | 'closed';

export const MAX_TIMEOUT_MS = 2_147_000_000;

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