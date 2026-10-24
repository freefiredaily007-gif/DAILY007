export type TournamentModeFilter = {
  gameMode?: unknown;
  mode?: unknown;
  teamType?: unknown;
};

export type TournamentModeItem = {
  gameMode?: unknown;
  game_mode?: unknown;
  mode?: unknown;
  teamType?: unknown;
  team_type?: unknown;
};

export type HomeRegistrationTournament = TournamentModeItem & {
  enabled?: unknown;
  status?: unknown;
  startsAt?: unknown;
  teamSize?: unknown;
  totalSlots?: unknown;
  totalPlayerSlots?: unknown;
  filledSlots?: unknown;
  filledPlayerSlots?: unknown;
  registrationOpen?: unknown;
  registration_open?: unknown;
};

export const HOME_GAME_MODE_CARDS = [
  { mode: 'Battle Royale', gameMode: 'battle_royale' },
  { mode: 'Clash Squad', gameMode: 'clash_squad' },
  { mode: 'Lone Wolf', gameMode: 'lone_wolf' },
] as const;

export type HomeGameMode = typeof HOME_GAME_MODE_CARDS[number]['gameMode'];
export type HomeOpenTournamentCounts = Record<HomeGameMode, number>;

export function homeModeRouteParams(card: { mode: string; gameMode: string }) {
  return { gameMode: card.gameMode, gameModeLabel: card.mode };
}

export function submodeRouteParams(gameMode: string, teamType: string, gameModeLabel: string) {
  return { gameMode, teamType, gameModeLabel };
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function filterTournamentsForRoute<T extends TournamentModeItem>(
  items: readonly T[],
  filters: TournamentModeFilter,
): T[] {
  const requestedMode = normalize(filters.gameMode || filters.mode);
  const requestedTeamType = normalize(filters.teamType);

  return items.filter((tournament) => {
    const tournamentMode = normalize(tournament.gameMode || tournament.game_mode || tournament.mode);
    const tournamentTeamType = normalize(tournament.teamType || tournament.team_type);
    return (!requestedMode || tournamentMode === requestedMode)
      && (!requestedTeamType || tournamentTeamType === requestedTeamType);
  });
}

export type TournamentLifecycleTab = 'upcoming' | 'ongoing' | 'completed';

export function tournamentTabsForRoute<T extends TournamentModeItem>(
  items: readonly T[],
  filters: TournamentModeFilter,
  lifecycleOf: (tournament: T) => string,
): Record<TournamentLifecycleTab, T[]> {
  const tabs: Record<TournamentLifecycleTab, T[]> = {
    upcoming: [],
    ongoing: [],
    completed: [],
  };
  const filtered = filterTournamentsForRoute(items, filters);

  for (const tournament of filtered) {
    const lifecycle = lifecycleOf(tournament);
    if (lifecycle === 'upcoming' || lifecycle === 'ongoing' || lifecycle === 'completed') {
      tabs[lifecycle].push(tournament);
    }
  }

  return tabs;
}

export function isHomeTournamentOpenForRegistration(
  tournament: HomeRegistrationTournament,
  now = Date.now(),
): boolean {
  if (tournament.enabled !== true ||
      tournament.registrationOpen === false ||
      tournament.registration_open === false) return false;

  const startsAt = Date.parse(String(tournament.startsAt ?? ''));
  const status = String(tournament.status ?? '').toLowerCase();
  if (!Number.isFinite(startsAt) || startsAt <= now ||
      ['cancelled', 'live', 'closed', 'completed', 'ongoing'].includes(status)) return false;

  const rawTeamSize = Number(tournament.teamSize ?? 1);
  const teamSize = Number.isSafeInteger(rawTeamSize) && rawTeamSize > 0 ? rawTeamSize : 1;
  const rawTeamSlots = Number(tournament.totalSlots);
  const totalPlayerSlots = Number(
    tournament.totalPlayerSlots ??
      (Number.isSafeInteger(rawTeamSlots) && rawTeamSlots > 0 ? rawTeamSlots * teamSize : NaN),
  );
  const rawFilledSlots = Number(tournament.filledSlots ?? 0);
  const filledPlayerSlots = Number(
    tournament.filledPlayerSlots ??
      (Number.isSafeInteger(rawFilledSlots) && rawFilledSlots >= 0 ? rawFilledSlots * teamSize : NaN),
  );

  return Number.isSafeInteger(totalPlayerSlots) &&
    totalPlayerSlots > 0 &&
    Number.isSafeInteger(filledPlayerSlots) &&
    filledPlayerSlots >= 0 &&
    filledPlayerSlots < totalPlayerSlots;
}

export function countOpenHomeTournamentsByMode(
  tournaments: readonly HomeRegistrationTournament[],
  now = Date.now(),
): HomeOpenTournamentCounts {
  const counts = Object.fromEntries(
    HOME_GAME_MODE_CARDS.map(({ gameMode }) => [gameMode, 0]),
  ) as HomeOpenTournamentCounts;

  for (const { gameMode } of HOME_GAME_MODE_CARDS) {
    counts[gameMode] = filterTournamentsForRoute(tournaments, { gameMode })
      .filter((tournament) => isHomeTournamentOpenForRegistration(tournament, now))
      .length;
  }

  return counts;
}

function displayFilterLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

export function tournamentListEmptyMessage(
  hasError: boolean,
  tabLabel: string,
  modeLabel?: string,
  teamType?: string,
): string {
  if (hasError) return 'Tournament data is unavailable right now. Pull to refresh and try again.';
  const formattedMode = displayFilterLabel(modeLabel);
  const formattedTeamType = displayFilterLabel(teamType);
  const tab = tabLabel.trim().toLowerCase();
  if (formattedTeamType) {
    const scope = [formattedTeamType, formattedMode].filter(Boolean).join(' ');
    return `No ${tab} tournaments are available.\nSelected format: ${scope}.`;
  }
  if (formattedMode) {
    return `No ${tab} tournaments are available.\nSelected game mode: ${formattedMode}.`;
  }
  return `No ${tab} tournaments are available right now.`;
}