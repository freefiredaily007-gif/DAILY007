import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createHomeRefreshRequestGuard,
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

test("out-of-order Home refreshes keep the newest paired tournament and registration snapshot", async () => {
  const guard = createHomeRefreshRequestGuard();
  const deferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
  };
  let visibleSnapshot = {
    tournaments: ["cached tournament"],
    registrations: ["cached registration"],
  };
  let visibleError = "";
  const applyPairedRefresh = async (requestId, tournamentsPromise, registrationsPromise) => {
    const [tournamentsResult, registrationsResult] = await Promise.allSettled([
      tournamentsPromise,
      registrationsPromise,
    ]);
    if (!guard.isCurrent(requestId)) return;
    if (tournamentsResult.status !== "fulfilled" || registrationsResult.status !== "fulfilled") {
      visibleError = "Could not load tournaments.";
      return;
    }
    visibleSnapshot = {
      tournaments: tournamentsResult.value,
      registrations: registrationsResult.value,
    };
    visibleError = "";
  };

  const olderRegistration = deferred();
  const olderRequestId = guard.start();
  const olderRefresh = applyPairedRefresh(
    olderRequestId,
    Promise.resolve(["older tournament"]),
    olderRegistration.promise,
  );

  const newerRequestId = guard.start();
  await applyPairedRefresh(
    newerRequestId,
    Promise.resolve(["newer tournament"]),
    Promise.resolve(["newer registration"]),
  );
  olderRegistration.resolve(["older registration"]);
  await olderRefresh;

  assert.deepEqual(visibleSnapshot, {
    tournaments: ["newer tournament"],
    registrations: ["newer registration"],
  });
  assert.equal(visibleError, "");

  const olderRegistrationAfterFailure = deferred();
  const olderRequestAfterFailureId = guard.start();
  const olderRefreshAfterFailure = applyPairedRefresh(
    olderRequestAfterFailureId,
    Promise.resolve(["stale tournament"]),
    olderRegistrationAfterFailure.promise,
  );
  const newerFailureRequestId = guard.start();
  await applyPairedRefresh(
    newerFailureRequestId,
    Promise.reject(new Error("newest request failed")),
    Promise.resolve(["newer registration"]),
  );
  assert.equal(visibleError, "Could not load tournaments.");
  olderRegistrationAfterFailure.resolve(["stale registration"]);
  await olderRefreshAfterFailure;
  assert.deepEqual(visibleSnapshot, {
    tournaments: ["newer tournament"],
    registrations: ["newer registration"],
  });
  assert.equal(visibleError, "Could not load tournaments.");

  const loadMethod = homeSource.match(
    /const load = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1];
  assert.ok(loadMethod, "Home must define its paired refresh loader.");
  assert.match(loadMethod, /const requestId = loadRequestGuardRef\.current\.start\(\)/);
  assert.match(loadMethod, /Promise\.allSettled/);
  const staleResponseGuard = loadMethod.indexOf(
    "if (!loadRequestGuardRef.current.isCurrent(requestId)) return;",
  );
  const applyItems = loadMethod.indexOf("setItems(");
  assert.ok(staleResponseGuard >= 0 && staleResponseGuard < applyItems);
  assert.match(loadMethod, /if \(loadRequestGuardRef\.current\.isCurrent\(requestId\)\) \{\s*setLoadError/);
  assert.match(loadMethod, /if \(loadRequestGuardRef\.current\.isCurrent\(requestId\)\) setLoading\(false\)/);
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
  assert.match(homeSource, /upcomingItems\.slice\(0, 8\)\.map\(\(t(?:,\s*index)?\)\s*=>/);
  assert.match(homeSource, /onPress=\{\(\) => openTournamentDetail\(t\.id\)\}/);
});

test("a failed refresh keeps upcoming cards visible and offers a retry", () => {
  const refreshFailureNotice = homeSource.match(
    /\{!loading && upcomingItems\.length > 0 && loadError && \([\s\S]*?testID="home-upcoming-refresh-error"[\s\S]*?\n\s*\)\}/,
  )?.[0];

  assert.ok(refreshFailureNotice, "A failed refresh with visible cards must show an inline notice.");
  assert.match(refreshFailureNotice, /The cards shown may be out of date/);
  assert.match(refreshFailureNotice, /accessibilityLiveRegion="polite"/);
  assert.match(refreshFailureNotice, /testID="home-upcoming-retry"/);
  assert.match(refreshFailureNotice, /accessibilityRole="button"/);
  assert.match(refreshFailureNotice, /onPress=\{onRefresh\}/);
  assert.match(refreshFailureNotice, /disabled=\{refreshing\}/);
  assert.match(refreshFailureNotice, /RETRYING…/);
  assert.ok(
    homeSource.indexOf('testID="home-upcoming-refresh-error"') <
      homeSource.indexOf('testID="home-upcoming-carousel"'),
    "The refresh notice must render without replacing the carousel.",
  );

  const loadMethod = homeSource.match(
    /const load = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1];
  const loadFailure = loadMethod?.match(/catch \(e: any\) \{([\s\S]*?)\n\s*\} finally/)?.[1];
  assert.ok(loadFailure, "Home must retain an explicit refresh-failure handler.");
  assert.match(loadFailure, /setLoadError/);
  assert.doesNotMatch(loadFailure, /setItems/, "A failed refresh must not clear existing cards.");

  const refreshHandler = homeSource.match(
    /const onRefresh = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  assert.match(refreshHandler ?? "", /await load\(\)/);
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