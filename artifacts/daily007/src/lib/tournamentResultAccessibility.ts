type TournamentResultAccessibilityDetails = {
  rank: number;
  gameName: string;
  teamName: string;
  kills: unknown;
  prizeCoins: unknown;
  killsVerified?: unknown;
  isKillEarn?: unknown;
  killRewardPaidCoins?: unknown;
  killRewardStatus?: unknown;
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
  killsVerified,
  isKillEarn,
  killRewardPaidCoins,
  killRewardStatus,
}: TournamentResultAccessibilityDetails): string {
  const spokenTeam = `team ${describeValue(teamName, 'unavailable')}`;
  const spokenKills = kills == null || String(kills).trim() === ''
    ? 'kills unavailable'
    : `${killsVerified === true ? 'verified ' : ''}${String(kills).trim()} kills`;
  const spokenPrize = `${describeValue(prizeCoins, '0')} coins`;
  const killReward = isKillEarn === true
    ? `Kill reward ${describeValue(killRewardPaidCoins, '0')} coins, ${
      killRewardStatus === 'paid'
        ? 'paid'
        : killRewardStatus === 'not_paid'
          ? 'not paid'
          : 'no bonus'
    }`
    : '';

  return [
    `Rank ${rank}`,
    `Free Fire name ${describeValue(gameName, 'unavailable')}`,
    spokenTeam,
    spokenKills,
    `prize ${spokenPrize}`,
    killReward,
  ].join(', ');
}
