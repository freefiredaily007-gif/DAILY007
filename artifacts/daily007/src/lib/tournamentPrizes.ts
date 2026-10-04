type TournamentPrizeSettings = {
  prizePool?: number | string | null;
  prizeDist?: string | null;
};

export function configuredPrizeForRank(tournament: TournamentPrizeSettings, rank: number): number {
  const configured = /(?:#\s*)?(\d+)(?:st|nd|rd|th)?\s*(?:place)?\s*[:=-]\s*([\d,]+)/gi;
  for (const match of String(tournament.prizeDist ?? '').matchAll(configured)) {
    if (Number(match[1]) === rank) return Number(match[2].replace(/,/g, ''));
  }
  return rank === 1 ? Number(tournament.prizePool) || 0 : 0;
}