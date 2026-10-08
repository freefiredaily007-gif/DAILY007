export type TournamentLifecycleState = 'upcoming' | 'ongoing' | 'completed' | 'closed';

export const MAX_TIMEOUT_MS = 2_147_000_000;
export const MAX_COMPLETED_TOURNAMENTS = 10;
export const TOURNAMENT_LIST_REFRESH_INTERVAL_MS = 30_000;
export const HOME_TOURNAMENT_REFRESH_INTERVAL_MS = TOURNAMENT_LIST_REFRESH_INTERVAL_MS;

export function createHomeRefreshRequestGuard() {
  let latestRequestId = 0;
  return {
    start: () => ++latestRequestId,
    isCurrent: (requestId: number) => requestId === latestRequestId,
  };
}

export function shouldRefreshHomeTournaments(appState: string): boolean {
  return appState === 'active';
}

type TournamentRefreshTimers = Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;

export function startTournamentListRefreshPolling(
  refresh: () => void,
  canRefresh: () => boolean,
  intervalMs = TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
  timers: TournamentRefreshTimers = globalThis,
): () => void {
  const interval = timers.setInterval(() => {
    if (canRefresh()) refresh();
  }, intervalMs);
  return () => timers.clearInterval(interval);
}

export function didAppReturnToForeground(previousState: string | null, nextState: string): boolean {
  return previousState !== 'active' && nextState === 'active';
}

export function startHomeTournamentRefreshPolling(
  refresh: () => void,
  canRefresh: () => boolean,
  intervalMs = HOME_TOURNAMENT_REFRESH_INTERVAL_MS,
): () => void {
  return startTournamentListRefreshPolling(refresh, canRefresh, intervalMs);
}

type TournamentDates = {
  completedAt?: Date | string | null;
  startsAt?: Date | string | null;
};

function timestamp(value: Date | string | null | undefined): number | null {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

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

export function mostRecentCompletedTournaments<T extends TournamentDates>(tournaments: readonly T[]): T[] {
  return [...tournaments]
    .sort((a, b) => {
      const aCompleted = timestamp(a.completedAt);
      const bCompleted = timestamp(b.completedAt);
      if (aCompleted === null && bCompleted !== null) return 1;
      if (aCompleted !== null && bCompleted === null) return -1;
      if (aCompleted !== null && bCompleted !== null && aCompleted !== bCompleted) {
        return bCompleted - aCompleted;
      }
      return compareTournamentStartTime(b, a);
    })
    .slice(0, MAX_COMPLETED_TOURNAMENTS);
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

export function getUpcomingHomeTournaments<T>(tournaments: readonly T[], now = Date.now()): T[] {
  return tournaments.filter((tournament) => getTournamentLifecycleState(tournament, now) === 'upcoming');
}
