type AdminPublishedResult = {
  rank: string | number;
  gameName?: string | null;
  playerName?: string | null;
  teamName?: string | null;
  kills?: string | number | null;
  prizeCoins?: string | number | null;
};

export function adminPublishedResultAccessibilityLabel(
  entry: AdminPublishedResult,
): string {
  const hasPlayerName = Boolean(entry.gameName || entry.playerName);
  const playerName = String(entry.gameName || entry.playerName || '');
  const teamName = String(entry.teamName || '');
  const participant = hasPlayerName
    ? `${playerName}${teamName && teamName !== playerName ? `, team ${teamName}` : ''}`
    : teamName
      ? `team ${teamName}`
      : 'Player';

  return `Rank ${entry.rank}, ${participant}, ${Number(entry.kills)} kills, prize ${Number(entry.prizeCoins).toLocaleString()} coins`;
}
