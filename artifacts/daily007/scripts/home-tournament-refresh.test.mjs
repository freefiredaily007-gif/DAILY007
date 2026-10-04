import assert from "node:assert/strict";
import test from "node:test";
import {
  getTournamentLifecycleState,
  HOME_TOURNAMENT_REFRESH_INTERVAL_MS,
  shouldRefreshHomeTournaments,
  startHomeTournamentRefreshPolling,
} from "../src/lib/tournamentLifecycle.ts";

test("Home polls only while active and stops polling when it loses focus", async () => {
  assert.equal(HOME_TOURNAMENT_REFRESH_INTERVAL_MS, 30_000);
  assert.equal(shouldRefreshHomeTournaments("active"), true);
  assert.equal(shouldRefreshHomeTournaments("background"), false);
  assert.equal(shouldRefreshHomeTournaments("inactive"), false);

  let appState = "background";
  let refreshes = 0;
  const stopPolling = startHomeTournamentRefreshPolling(
    () => { refreshes += 1; },
    () => shouldRefreshHomeTournaments(appState),
    5,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(refreshes, 0);

    appState = "active";
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(refreshes > 0);

    stopPolling();
    const stoppedCount = refreshes;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(refreshes, stoppedCount);
  } finally {
    stopPolling();
  }
});

test("a cancelled or disabled tournament closes while unaffected upcoming matches remain visible", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const latest = [
    { id: "cancelled", status: "cancelled", startsAt: "2026-10-05T12:00:00Z" },
    { id: "disabled", enabled: false, startsAt: "2026-10-06T12:00:00Z" },
    { id: "upcoming", enabled: true, status: "upcoming", startsAt: "2026-10-07T12:00:00Z" },
  ];

  assert.deepEqual(
    latest
      .filter((tournament) => getTournamentLifecycleState(tournament, now) === "upcoming")
      .map((tournament) => tournament.id),
    ["upcoming"],
  );
});