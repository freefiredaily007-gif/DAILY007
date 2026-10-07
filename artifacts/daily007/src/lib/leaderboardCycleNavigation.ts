export type LeaderboardCycle = "weekly" | "monthly";

export function getLeaderboardCycleFromRouteParam(value: unknown): LeaderboardCycle {
  return value === "monthly" ? "monthly" : "weekly";
}

export function handleLeaderboardCycleArrowKey(
  focusedCycle: LeaderboardCycle,
  key: string,
  actions: {
    preventDefault: () => void;
    focusTab: (cycle: LeaderboardCycle) => void;
    selectCycle: (cycle: LeaderboardCycle) => void;
  },
): LeaderboardCycle | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;

  const nextCycle = focusedCycle === "weekly" ? "monthly" : "weekly";
  actions.preventDefault();
  actions.focusTab(nextCycle);
  actions.selectCycle(nextCycle);
  return nextCycle;
}
