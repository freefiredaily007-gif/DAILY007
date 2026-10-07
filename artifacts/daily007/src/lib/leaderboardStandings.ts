type RankedStanding = {
  rank: number;
};

export function selectLeaderboardPodiumRanks(largeText: boolean): Array<1 | 2 | 3> {
  // Accessibility traversal follows the rendered order: left-to-right for the standard layout,
  // and top-to-bottom rank order when large text stacks the cards vertically.
  return largeText ? [1, 2, 3] : [2, 1, 3];
}

export function selectLeaderboardTopTwenty<T extends RankedStanding>(
  standings: readonly T[] | undefined,
): T[] {
  return [...(standings ?? [])]
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 20);
}

export function selectLeaderboardExpandedRows<T extends RankedStanding>(
  standings: readonly T[],
): T[] {
  return standings
    .filter((standing) => standing.rank > 3)
    .slice(0, 17);
}

export function leaderboardPlayerAccessibilityLabel(standing: {
  rank: number;
  name: string;
  points: number;
}): string {
  return `Rank ${standing.rank}, ${standing.name}, ${standing.points.toLocaleString("en-IN")} coins`;
}

export function leaderboardPodiumAccessibilityLabel(
  rank: number,
  standing?: {
    name: string;
    points: number;
  },
): string {
  return standing
    ? leaderboardPlayerAccessibilityLabel({ rank, ...standing })
    : `Rank ${rank}, player not available, coin score not available`;
}
