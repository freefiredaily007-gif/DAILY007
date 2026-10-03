export type LeaderboardCycleType = "weekly" | "monthly";
export type LeaderboardPeriodStatus =
  | "active"
  | "pending_approval"
  | "pending_activation"
  | "finalized";

export type LeaderboardStanding = {
  rank: number;
  userId: string;
  name: string;
  points: number;
  earnings: number;
  wins: number;
  kills: number;
  matches: number;
};

export type LeaderboardPayout = {
  rank: number;
  coins: number;
};

export type LeaderboardWindow = {
  startsAt: Date;
  endsAt: Date;
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function leaderboardPeriodWindow(
  cycleType: LeaderboardCycleType,
  at: Date,
): LeaderboardWindow {
  const timestamp = at.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError("Leaderboard period date must be valid.");
  }

  const indiaDate = new Date(timestamp + IST_OFFSET_MS);
  const year = indiaDate.getUTCFullYear();
  const month = indiaDate.getUTCMonth();
  let startUtc: number;
  let endUtc: number;

  if (cycleType === "weekly") {
    const daysSinceMonday = (indiaDate.getUTCDay() + 6) % 7;
    startUtc = Date.UTC(
      year,
      month,
      indiaDate.getUTCDate() - daysSinceMonday,
    ) - IST_OFFSET_MS;
    endUtc = startUtc + 7 * DAY_MS;
  } else {
    startUtc = Date.UTC(year, month, 1) - IST_OFFSET_MS;
    endUtc = Date.UTC(year, month + 1, 1) - IST_OFFSET_MS;
  }

  return {
    startsAt: new Date(startUtc),
    endsAt: new Date(endUtc),
  };
}

export function nextLeaderboardPeriodWindow(
  cycleType: LeaderboardCycleType,
  previousEndsAt: Date,
): LeaderboardWindow {
  const end = previousEndsAt.getTime();
  if (!Number.isFinite(end)) {
    throw new RangeError("Previous leaderboard period end must be valid.");
  }
  const next = leaderboardPeriodWindow(cycleType, new Date(end + 1));
  if (next.startsAt.getTime() !== end) {
    throw new RangeError("Leaderboard period boundary is not aligned to IST.");
  }
  return next;
}

export function rankLeaderboardStandings(
  rows: Omit<LeaderboardStanding, "rank">[],
): LeaderboardStanding[] {
  return [...rows]
    .sort((a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
      a.userId.localeCompare(b.userId),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function parseSafeInteger(value: number | string, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${label} is outside the supported numeric range.`);
  }
  return parsed;
}