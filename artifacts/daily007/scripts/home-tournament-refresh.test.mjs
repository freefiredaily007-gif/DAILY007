import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  didAppReturnToForeground,
  getUpcomingHomeTournaments,
  getTournamentLifecycleState,
  HOME_TOURNAMENT_REFRESH_INTERVAL_MS,
  shouldRefreshHomeTournaments,
  startHomeTournamentRefreshPolling,
} from "../src/lib/tournamentLifecycle.ts";

const homeSource = await readFile(
  new URL("../src/screens/Home.tsx", import.meta.url),
  "utf8",
);

test("Home polls only while active and stops polling when it loses focus", async () => {
  assert.equal(HOME_TOURNAMENT_REFRESH_INTERVAL_MS, 30_000);
  assert.equal(shouldRefreshHomeTournaments("active"), true);
  assert.equal(shouldRefreshHomeTournaments("background"), false);
  assert.equal(shouldRefreshHomeTournaments("inactive"), false);
  assert.equal(didAppReturnToForeground("background", "active"), true);
  assert.equal(didAppReturnToForeground("inactive", "active"), true);
  assert.equal(didAppReturnToForeground("active", "active"), false);
  assert.equal(didAppReturnToForeground("active", "background"), false);

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

test("Home advances its lifecycle clock and refreshes tournament data on foreground resume", () => {
  const resumeHandler = homeSource.match(
    /if \(returnedToApp\) \{([\s\S]*?)\n\s*\}/,
  )?.[1];

  assert.ok(resumeHandler, "Home must handle an app foreground transition.");
  assert.match(resumeHandler, /setClockNow\(Date\.now\(\)\)/);
  assert.match(resumeHandler, /refreshHomeIfIdle\(\)/);
});

test("Home queues a foreground refresh when an older request is still running", () => {
  assert.match(
    homeSource,
    /if \(activeRequestsRef\.current > 0 \|\| homePollInFlightRef\.current\) \{\s*resumeRefreshPendingRef\.current = true;\s*return;\s*\}/,
  );
  assert.match(homeSource, /activeRequestsRef\.current === 0 &&\s*resumeRefreshPendingRef\.current/);
  assert.match(homeSource, /refreshHomeIfIdleRef\.current\(\)/);
});

test("a tournament that starts while Home is backgrounded leaves the upcoming carousel", () => {
  const startAt = Date.parse("2026-10-05T17:30:00+05:30");
  const tournaments = [
    { id: "started", startsAt: "2026-10-05T17:30:00+05:30", status: "upcoming" },
    { id: "remaining", startsAt: new Date(startAt + 60_000).toISOString(), status: "upcoming" },
  ];

  assert.deepEqual(
    getUpcomingHomeTournaments(tournaments, startAt - 1).map((tournament) => tournament.id),
    ["started", "remaining"],
  );
  assert.deepEqual(
    getUpcomingHomeTournaments(tournaments, startAt).map((tournament) => tournament.id),
    ["remaining"],
  );
});

test("remaining upcoming cards stay swipeable and open their tournament details", () => {
  assert.match(homeSource, /<ScrollView[\s\S]*?horizontal pagingEnabled/);
  assert.match(homeSource, /upcomingItems\.slice\(0, 8\)\.map\(\(t\)/);
  assert.match(homeSource, /onPress=\{\(\) => openTournamentDetail\(t\.id\)\}/);
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