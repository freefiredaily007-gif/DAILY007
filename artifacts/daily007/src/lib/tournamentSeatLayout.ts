export type TournamentSeatLayout = {
  gameMode: 'battle_royale' | 'clash_squad' | 'lone_wolf';
  teamType: 'solo' | 'duo' | 'trio' | 'squad';
  groupCount: number;
  slotsPerGroup: number;
  groupKind: 'player' | 'team';
  directDuel: boolean;
  individualSquad: boolean;
};

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[-\s]+/g, '_')
    : '';
}

export function getTournamentSeatLayout(tournament: {
  mode?: unknown;
  gameMode?: unknown;
  teamType?: unknown;
  teamSize?: unknown;
}): TournamentSeatLayout | null {
  const explicitGameMode = normalized(tournament.gameMode);
  const rawMode = explicitGameMode || normalized(tournament.mode);
  const gameMode = rawMode === 'br' || rawMode === 'battle_royale' || rawMode === 'battle_royale_mode' ||
    (!explicitGameMode && ['solo', 'duo', 'trio', 'squad'].includes(rawMode))
    ? 'battle_royale'
    : rawMode === 'clash' || rawMode === 'cs' || rawMode === 'clash_squad'
      ? 'clash_squad'
      : rawMode === 'lw' || rawMode === 'lonewolf' || rawMode === 'lone_wolf'
        ? 'lone_wolf'
        : null;
  const teamTypeValue = normalized(tournament.teamType);
  const teamType = teamTypeValue === 'solo' || teamTypeValue === 'duo' ||
    teamTypeValue === 'trio' || teamTypeValue === 'squad'
    ? teamTypeValue
    : null;
  if (!gameMode || !teamType) return null;

  if (gameMode === 'battle_royale' && teamType === 'trio') return null;
  const slotsPerGroup = teamType === 'solo' ? 1 : teamType === 'duo' ? 2 : teamType === 'trio' ? 3 : 4;
  if (gameMode === 'battle_royale') {
    const groupCount = teamType === 'solo' ? 48 : teamType === 'duo' ? 24 : 12;
    return {
      gameMode,
      teamType,
      groupCount,
      slotsPerGroup,
      groupKind: teamType === 'solo' ? 'player' : 'team',
      directDuel: false,
      individualSquad: teamType === 'squad',
    };
  }

  return {
    gameMode,
    teamType,
    groupCount: 2,
    slotsPerGroup,
    groupKind: teamType === 'solo' ? 'player' : 'team',
    directDuel: teamType === 'solo',
    individualSquad: false,
  };
}
