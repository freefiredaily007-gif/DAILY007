import assert from "node:assert/strict";
import test from "node:test";
import {
  leaderboardPeriodWindow,
  nextLeaderboardPeriodWindow,
  rankLeaderboardStandings,
} from "./daily007-leaderboard-core";

test("weekly leaderboard windows use Monday-to-Sunday dates in India time", () => {
  const window = leaderboardPeriodWindow("weekly", new Date("2026-10-03T00:00:00.000Z"));
  assert.equal(window.startsAt.toISOString(), "2026-09-27T18:30:00.000Z");
  assert.equal(window.endsAt.toISOString(), "2026-10-04T18:30:00.000Z");
});

test("a period boundary starts the next weekly window without a gap", () => {
  const boundary = new Date("2026-10-04T18:30:00.000Z");
  const next = nextLeaderboardPeriodWindow("weekly", boundary);
  assert.equal(next.startsAt.toISOString(), boundary.toISOString());
  assert.equal(next.endsAt.toISOString(), "2026-10-11T18:30:00.000Z");
});

test("monthly leaderboard windows follow India calendar months, including year rollover", () => {
  const october = leaderboardPeriodWindow("monthly", new Date("2026-10-03T00:00:00.000Z"));
  assert.equal(october.startsAt.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(october.endsAt.toISOString(), "2026-10-31T18:30:00.000Z");

  const january = leaderboardPeriodWindow("monthly", new Date("2026-12-31T19:00:00.000Z"));
  assert.equal(january.startsAt.toISOString(), "2026-12-31T18:30:00.000Z");
  assert.equal(january.endsAt.toISOString(), "2027-01-31T18:30:00.000Z");
});

test("standings score by prize coins and break ties by wins, kills, then player name", () => {
  const standings = rankLeaderboardStandings([
    { userId: "b", name: "Bora", points: 50, earnings: 50, wins: 1, kills: 3, matches: 2 },
    { userId: "c", name: "Chetan", points: 60, earnings: 60, wins: 0, kills: 2, matches: 2 },
    { userId: "a", name: "Anya", points: 50, earnings: 50, wins: 1, kills: 4, matches: 3 },
    { userId: "d", name: "Dev", points: 50, earnings: 50, wins: 1, kills: 4, matches: 1 },
  ]);

  assert.deepEqual(
    standings.map(({ rank, userId }) => [rank, userId]),
    [[1, "c"], [2, "a"], [3, "d"], [4, "b"]],
  );
});