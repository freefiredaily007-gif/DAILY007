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
  if (registrationsResult.status === 'rejected') throw registrationsResult.reason;

  const registrations = Array.isArray(registrationsResult.value)
    ? registrationsResult.value
    : [];
  const registration = registrations.find((item: any) =>
    String(item.tournamentId) === String(tournamentId) &&
    ['approved', 'pending'].includes(String(item.status ?? '').toLowerCase()),
  );

  return {
    ...tournamentResult.value,
    joined: Boolean(registration),
    myRegistration: registration,
  };
}

type IntervalTimers = Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;

export function startTournamentDetailPolling(
  isFocused: boolean,
  refresh: () => void,
  timers: IntervalTimers = globalThis,
): () => void {
  if (!isFocused) return () => {};

  const timer = timers.setInterval(refresh, TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS);
  return () => timers.clearInterval(timer);
}
