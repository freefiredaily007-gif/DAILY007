export type TournamentWinnerDetailsState<T> =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-winner' }
  | { kind: 'winner'; entry: T };

export const TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS = 30_000;

export function getTournamentResultsRefreshInterval(
  isCompleted: boolean,
  isFocused: boolean,
): number | false {
  return isCompleted && isFocused ? TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS : false;
}

export function resolveTournamentWinnerState<T extends { rank: number | string }>(
  isLoading: boolean,
  isError: boolean,
  entries: readonly T[] | undefined,
): TournamentWinnerDetailsState<T> {
  if (isLoading && entries === undefined) return { kind: 'loading' };
  if (isError) return { kind: 'error' };

  const entry = entries?.find((result) => Number(result.rank) === 1);
  return entry ? { kind: 'winner', entry } : { kind: 'no-winner' };
}