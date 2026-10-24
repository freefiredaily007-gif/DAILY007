export type TournamentGameMode = 'battle_royale' | 'clash_squad' | 'lone_wolf';
export type TournamentTeamType = 'solo' | 'duo' | 'trio' | 'squad';

export type TournamentFormatCapacity = {
  playersPerTeam: number;
  slots: number;
  totalPlayers: number;
  label: string;
};

export function getTournamentFormatCapacity(
  gameMode: TournamentGameMode,
  teamType: TournamentTeamType,
  playersPerTeam: number,
): TournamentFormatCapacity {
  if (gameMode === 'battle_royale') {
    if (teamType === 'solo') {
      return {
        playersPerTeam,
        slots: 48,
        totalPlayers: 48,
        label: '48 player slots',
      };
    }
    const slots = teamType === 'duo' ? 24 : 12;
    return {
      playersPerTeam,
      slots,
      totalPlayers: 48,
      label: `${slots} team slots · 48 players`,
    };
  }

  const slots = 2;
  const totalPlayers = playersPerTeam * slots;
  return {
    playersPerTeam,
    slots,
    totalPlayers,
    label: `${slots} team slots · ${totalPlayers} players`,
  };
}
