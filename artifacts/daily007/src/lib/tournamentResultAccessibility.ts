type TournamentResultAccessibilityDetails = {
  rank: number;
  gameName: string;
  teamName: string;
  kills: unknown;
  prizeCoins: unknown;
};

function describeValue(value: unknown, unavailable: string): string {
  return value == null || String(value).trim() === '' ? unavailable : String(value).trim();
}

export function tournamentResultAccessibilityLabel({
  rank,
  gameName,
  teamName,
  kills,
  prizeCoins,
}: TournamentResultAccessibilityDetails): string {
  const spokenTeam = `team ${describeValue(teamName, 'unavailable')}`;
  const spokenKills = kills == null || String(kills).trim() === ''
    ? 'kills unavailable'
    : `${String(kills).trim()} kills`;
  const spokenPrize = `${describeValue(prizeCoins, '0')} coins`;

  return [
    `Rank ${rank}`,
    `Free Fire name ${describeValue(gameName, 'unavailable')}`,
    spokenTeam,
    spokenKills,
    `prize ${spokenPrize}`,
  ].join(', ');
}
