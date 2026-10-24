type AdminPublishedResult = {
  rank: string | number;
  gameName?: string | null;
  playerName?: string | null;
  teamName?: string | null;
  kills?: string | number | null;
  prizeCoins?: string | number | null;
  isKillEarn?: boolean;
  killRewardPaidCoins?: string | number | null;
  killRewardStatus?: string;
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

  const verifiedKills = `${Number(entry.kills)} ${entry.isKillEarn ? 'admin-verified ' : ''}kills`;
  const killReward = entry.isKillEarn
    ? `, kill reward ${Number(entry.killRewardPaidCoins ?? 0).toLocaleString()} coins, ${
      entry.killRewardStatus === 'paid'
        ? 'paid'
        : entry.killRewardStatus === 'not_paid'
          ? 'not paid'
          : 'no bonus'
    }`
    : '';
  return `Rank ${entry.rank}, ${participant}, ${verifiedKills}${killReward}, prize ${Number(entry.prizeCoins).toLocaleString()} coins`;
}
