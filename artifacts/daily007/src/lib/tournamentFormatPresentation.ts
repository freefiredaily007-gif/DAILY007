export type TournamentFormat = 'solo' | 'duo' | 'squad';

export type TournamentFormatArtwork<TImage> = {
  tournamentFormatArt: Record<TournamentFormat, TImage>;
  battleRoyalePosterArt: Record<TournamentFormat, TImage>;
};

export function getTournamentFormatPresentation<TImage>(
  t: any,
  artwork: TournamentFormatArtwork<TImage>,
) {
  const teamType = String(t?.teamType || '').trim().toLowerCase();
  const format: TournamentFormat =
    teamType === 'duo' || teamType === 'squad' ? teamType : 'solo';
  const modeKey = String(t?.gameMode || t?.mode || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const isBattleRoyale = modeKey === 'battle_royale';

  return {
    format,
    label: format.toUpperCase(),
    matchup: format === 'solo' ? '1 VS 1' : format === 'duo' ? '2 VS 2' : '4 VS 4',
    image: isBattleRoyale
      ? artwork.battleRoyalePosterArt[format]
      : artwork.tournamentFormatArt[format],
    showBattleRoyalePoster: isBattleRoyale,
    showFormatBanner:
      !isBattleRoyale &&
      ['clash_squad', 'lone_wolf', 'clash', 'clashsquad', 'lonewolf'].includes(modeKey),
  };
}