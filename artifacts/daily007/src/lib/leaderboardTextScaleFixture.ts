export type LeaderboardTextScaleCycle = "weekly" | "monthly";

export function createLeaderboardTextScalePeriod(cycleType: LeaderboardTextScaleCycle) {
  return {
    cycleType,
    status: "active" as const,
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-10-08T00:00:00.000Z",
    standings: Array.from({ length: 20 }, (_, index) => {
      const rank = index + 1;
      const name = rank === 1
        ? `${cycleType === "weekly" ? "Weekly" : "Monthly"} Champion With A Long Display Name`
        : rank === 4
          ? "International Tournament Competitor With A Player Name That Wraps Across Multiple Lines"
          : rank === 20
            ? "Rank Twenty Final Player"
            : `Tournament Competitor ${rank}`;
      return {
        rank,
        userId: `largest-text-${cycleType}-${rank}`,
        name,
        points: rank === 20 ? 1_234_567 : 20_000 - rank * 731,
        earnings: 0,
        wins: 0,
        kills: 0,
        matches: 0,
      };
    }),
    rewards: [
      { rank: 1, coins: 5000 },
      { rank: 2, coins: 2500 },
      { rank: 3, coins: 1000 },
    ],
  };
}

export const LEADERBOARD_TEXT_SCALE_FIXTURE = {
  weekly: createLeaderboardTextScalePeriod("weekly"),
  monthly: createLeaderboardTextScalePeriod("monthly"),
};
