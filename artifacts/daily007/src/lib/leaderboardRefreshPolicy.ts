export const LEADERBOARD_REFRESH_POLICY = {
  refetchInterval: 30_000,
  refetchOnMount: "always",
} as const;

export type LeaderboardTopThreeStanding = {
  rank: number;
  userId: string;
  name: string;
  points: number;
};

type TopThreePlayer = Pick<LeaderboardTopThreeStanding, "userId" | "name" | "points">;

export type LeaderboardTopThreeSnapshot = Record<1 | 2 | 3, TopThreePlayer | null>;

export function selectLeaderboardTopThreeSnapshot(
  standings: readonly LeaderboardTopThreeStanding[] | null | undefined,
): LeaderboardTopThreeSnapshot {
  const playerAtRank = (rank: 1 | 2 | 3): TopThreePlayer | null => {
    const standing = standings?.find((player) => player.rank === rank);
    return standing
      ? { userId: standing.userId, name: standing.name, points: standing.points }
      : null;
  };

  return {
    1: playerAtRank(1),
    2: playerAtRank(2),
    3: playerAtRank(3),
  };
}

export function getLeaderboardTopThreeUpdateAnnouncement(
  previous: LeaderboardTopThreeSnapshot,
  current: LeaderboardTopThreeSnapshot,
): string | null {
  const changedRanks = ([1, 2, 3] as const).filter((rank) => {
    const before = previous[rank];
    const after = current[rank];
    return before?.userId !== after?.userId
      || before?.name !== after?.name
      || before?.points !== after?.points;
  });

  if (changedRanks.length === 0) return null;

  const changes = changedRanks.map((rank) => {
    const player = current[rank];
    if (!player) return `Rank ${rank} no longer has a player`;
    const name = player.name.trim() || "player not available";
    return `Rank ${rank}, ${name}, ${player.points.toLocaleString("en-IN")} coins`;
  });

  return `Leaderboard updated. ${changes.join("; ")}.`;
}

export function refetchLeaderboardOnFocus(refetch: () => unknown): void {
  void refetch();
}