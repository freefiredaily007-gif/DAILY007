export type TournamentFormat = 'solo' | 'duo' | 'trio' | 'squad';
type TournamentArtworkFormat = Exclude<TournamentFormat, 'trio'>;

export type TournamentFormatArtwork<TImage> = {
  tournamentFormatArt: Record<TournamentArtworkFormat, TImage>;
  battleRoyalePosterArt: Record<TournamentArtworkFormat, TImage>;
};

export function getTournamentFormatPresentation<TImage>(
  t: any,
  artwork: TournamentFormatArtwork<TImage>,
) {
  const teamType = String(t?.teamType || '').trim().toLowerCase();
  const format: TournamentFormat =
    teamType === 'duo' || teamType === 'trio' || teamType === 'squad' ? teamType : 'solo';
  const artworkFormat = format === 'trio' ? 'duo' : format;
  const modeKey = String(t?.gameMode || t?.mode || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const isBattleRoyale = modeKey === 'battle_royale';

  return {
    format,
    label: format.toUpperCase(),
    matchup: format === 'solo' ? '1 VS 1' : format === 'duo' ? '2 VS 2' : format === 'trio' ? '3 VS 3' : '4 VS 4',
    image: isBattleRoyale
      ? artwork.battleRoyalePosterArt[artworkFormat]
      : artwork.tournamentFormatArt[artworkFormat],
    showBattleRoyalePoster: isBattleRoyale,
    showFormatBanner:
      !isBattleRoyale &&
      ['clash_squad', 'lone_wolf', 'clash', 'clashsquad', 'lonewolf'].includes(modeKey),
  };
}