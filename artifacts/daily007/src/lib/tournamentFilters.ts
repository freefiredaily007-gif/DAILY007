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

export const HOME_GAME_MODE_CARDS = [
  { mode: 'Battle Royale', gameMode: 'battle_royale' },
  { mode: 'Clash Squad', gameMode: 'clash_squad' },
  { mode: 'Lone Wolf', gameMode: 'lone_wolf' },
] as const;

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
  const scope = [teamType, modeLabel]
    .map(displayFilterLabel)
    .filter(Boolean)
    .join(' ');
  const tab = tabLabel.trim().toLowerCase();
  return scope
    ? `No ${tab} tournaments are available.\nSelected format: ${scope}.`
    : `No ${tab} tournaments are available right now.`;
}