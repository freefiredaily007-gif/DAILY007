export const TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS = 30_000;

type TournamentDetailApi = {
  tournament: (id: string) => Promise<Record<string, unknown>>;
  myRegistrations: () => Promise<unknown>;
};

export async function fetchTournamentDetailSnapshot(
  tournamentId: string,
  api: TournamentDetailApi,
) {
  const [tournamentResult, registrationsResult] = await Promise.allSettled([
    Promise.resolve().then(() => api.tournament(tournamentId)),
    Promise.resolve().then(() => api.myRegistrations()),
  ]);

  if (tournamentResult.status === 'rejected') throw tournamentResult.reason;
  if (
    registrationsResult.status === 'fulfilled' &&
    !Array.isArray(registrationsResult.value)
  ) {
    throw new Error(
      'Could not verify your entry status. Your last confirmed status is shown. Pull to refresh to try again.',
    );
  }

  const registrations =
    registrationsResult.status === 'fulfilled'
      ? registrationsResult.value as any[]
      : [];
  const registrationStatusKnown = registrationsResult.status === 'fulfilled';
  const registration = registrations.find((item: any) =>
    String(item.tournamentId) === String(tournamentId) &&
    ['approved', 'pending'].includes(String(item.status ?? '').toLowerCase()),
  );

  return {
    ...tournamentResult.value,
    registrationStatusKnown,
    joined: registrationStatusKnown ? Boolean(registration) : null,
    myRegistration: registration,
  };
}

type IntervalTimers = Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;

export function createTournamentDetailRefreshController(
  timers: IntervalTimers = globalThis,
): {
  update: (isFocused: boolean, isAppActive: boolean, refresh: () => void) => void;
  stop: () => void;
} {
  let shouldRefresh = false;
  let timer: ReturnType<typeof timers.setInterval> | undefined;
  let refreshLatest: () => void | Promise<void> = () => {};

  const refreshIfCurrent = () => {
    if (shouldRefresh) return refreshLatest();
    return undefined;
  };

  return {
    update(isFocused, isAppActive, refresh) {
      refreshLatest = refresh;
      const nextShouldRefresh = isFocused && isAppActive;
      if (nextShouldRefresh === shouldRefresh) return;

      shouldRefresh = nextShouldRefresh;
      if (shouldRefresh) {
        void refreshIfCurrent();
        timer = timers.setInterval(refreshIfCurrent, TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS);
      } else if (timer !== undefined) {
        timers.clearInterval(timer);
        timer = undefined;
      }
    },
    stop() {
      shouldRefresh = false;
      if (timer !== undefined) {
        timers.clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
