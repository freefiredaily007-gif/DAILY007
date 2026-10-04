export const LEADERBOARD_REFRESH_POLICY = {
  refetchInterval: 30_000,
  refetchOnMount: "always",
} as const;

export function refetchLeaderboardOnFocus(refetch: () => unknown): void {
  void refetch();
}