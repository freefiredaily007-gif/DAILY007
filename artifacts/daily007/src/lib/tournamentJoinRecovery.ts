type TournamentJoinError = {
  response?: {
    status?: unknown;
    data?: unknown;
  };
};

type TournamentCapacity = {
  status?: string;
  totalSlots?: number;
  totalPlayerSlots?: number;
  filledSlots?: number;
  filledPlayerSlots?: number;
  availableSlots?: number;
};

const MATCH_FULL_ERROR_CODE = 'MATCH_FULL';

export function isFullMatchRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as TournamentJoinError).response;
  if (response?.status !== 409 || !response.data || typeof response.data !== 'object') {
    return false;
  }

  const data = response.data as { code?: unknown };
  return data.code === MATCH_FULL_ERROR_CODE;
}

export async function joinWithCapacityRefresh<Tournament extends TournamentCapacity, Result>(
  joinRequest: () => Promise<Result>,
  tournamentId: string,
  fetchTournament: (id: string) => Promise<Tournament>,
  setTournament: (tournament: Tournament | ((current: Tournament) => Tournament)) => void,
): Promise<Result> {
  try {
    return await joinRequest();
  } catch (error) {
    if (isFullMatchRejection(error)) {
      try {
        setTournament(await fetchTournament(tournamentId));
      } catch {
        setTournament((current) => ({
          ...current,
          status: 'full',
          filledSlots: current.totalSlots ?? current.filledSlots,
          filledPlayerSlots: current.totalPlayerSlots ?? current.filledPlayerSlots,
          availableSlots: 0,
        }));
      }
    }
    throw error;
  }
}