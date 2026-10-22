import { getTournamentLifecycleState } from './tournamentLifecycle';

export type AdminTournamentTab = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

export function filterAdminTournamentsByTab<T extends { status?: string }>(
  tournaments: readonly T[],
  tab: AdminTournamentTab,
  now = Date.now(),
): T[] {
  return tournaments.filter((tournament) => tab === 'cancelled'
    ? String(tournament.status ?? '').toLowerCase() === 'cancelled'
    : getTournamentLifecycleState(tournament, now) === tab);
}
