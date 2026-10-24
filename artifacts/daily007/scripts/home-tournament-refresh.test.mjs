import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  createHomeRefreshRequestGuard,
  createHomeRefreshSingleFlight,
  didAppReturnToForeground,
  formatHomeRefreshTimestamp,
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
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);
const homeSourceFile = ts.createSourceFile(
  "Home.tsx",
  homeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const apiSourceFile = ts.createSourceFile(
  "api.ts",
  apiSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function findVariableInitializer(sourceFile, variableName) {
  let initializer;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
    ) {
      initializer = node.initializer ?? undefined;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(initializer, `The ${variableName} initializer should be present.`);
  return initializer;
}

function evaluateTypeScriptExpression(expression, sourceFile, scope = {}) {
  const javascript = ts.transpileModule(
    `const __runtimeValue = (${expression.getText(sourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __runtimeValue;`,
  )(...Object.values(scope));
}

const homeMergeHelpers = homeSourceFile.statements.filter(
  (statement) =>
    ts.isFunctionDeclaration(statement)
    && ["hasSameHomeTournamentData", "mergeHomeTournamentItems"].includes(statement.name?.text ?? ""),
);
assert.equal(
  homeMergeHelpers.length,
  2,
  "Home's tournament merge helpers should be available for the refresh test.",
);
const homeMergeHelpersJavascript = ts.transpileModule(
  homeMergeHelpers
    .map((statement) => statement.getText(homeSourceFile).replace(/^export\s+/, ""))
    .join("\n"),
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const mergeHomeTournamentItems = new Function(
  `${homeMergeHelpersJavascript}\nreturn mergeHomeTournamentItems;`,
)();

const apiObject = findVariableInitializer(apiSourceFile, "Api");
assert.ok(ts.isObjectLiteralExpression(apiObject), "The shared API object should be present.");
const myRegistrationsProperty = apiObject.properties.find(
  (property) =>
    ts.isPropertyAssignment(property)
    && property.name.getText(apiSourceFile) === "myRegistrations",
);
assert.ok(
  myRegistrationsProperty && ts.isPropertyAssignment(myRegistrationsProperty),
  "The shared myRegistrations API method should be present.",
);

function createHomeLoadHarness(api) {
  const state = {
    items: [],
    loading: true,
    loadError: "",
    lastSuccessfulRefreshAt: null,
    clockNow: 0,
  };
  const scope = {
    useCallback: (callback) => callback,
    api,
    loadRequestGuardRef: { current: createHomeRefreshRequestGuard() },
    loadSingleFlightRef: { current: createHomeRefreshSingleFlight() },
    activeRequestsRef: { current: 0 },
    resumeRefreshPendingRef: { current: false },
    homePollInFlightRef: { current: false },
    refreshHomeIfIdleRef: { current: () => {} },
    mergeHomeTournamentItems,
    setItems: (update) => {
      state.items = typeof update === "function" ? update(state.items) : update;
    },
    setLoading: (loading) => {
      state.loading = loading;
    },
    setLoadError: (loadError) => {
      state.loadError = loadError;
    },
    setLastSuccessfulRefreshAt: (timestamp) => {
      state.lastSuccessfulRefreshAt = timestamp;
    },
    setClockNow: (timestamp) => {
      state.clockNow = timestamp;
    },
  };
  const load = evaluateTypeScriptExpression(
    findVariableInitializer(homeSourceFile, "load"),
    homeSourceFile,
    scope,
  );
  return { load, state };
}

function createSharedMyRegistrations(http) {
  return evaluateTypeScriptExpression(
    myRegistrationsProperty.initializer,
    apiSourceFile,
    { http, unwrap: (response) => response, LIVE_DATA_HEADERS: {} },
  );
}

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
  const refreshStart = homeSource.indexOf("const refreshHomeIfIdle = useCallback");
  const refreshEnd = homeSource.indexOf("\n  }, [load]);", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  const refreshHandler = homeSource.slice(refreshStart, refreshEnd);
  assert.match(refreshHandler, /if \(homePollInFlightRef\.current\) return/);
  assert.match(
    refreshHandler,
    /if \(activeRequestsRef\.current > 0\) \{\s*resumeRefreshPendingRef\.current = true;\s*return;\s*\}/,
  );
  assert.match(
    homeSource,
    /activeRequestsRef\.current === 0 &&\s*resumeRefreshPendingRef\.current &&\s*!homePollInFlightRef\.current/,
  );
  assert.match(homeSource, /refreshHomeIfIdleRef\.current\(\)/);
});

test("Home skips a queued refresh while unfocused or inactive", () => {
  assert.match(
    homeSource,
    /if \(!homeFocusedRef\.current \|\| !shouldRefreshHomeTournaments\(appStateRef\.current\)\) return;/,
  );
  assert.match(
    homeSource,
    /if \(!shouldRefreshHomeTournaments\(nextState\)\) \{\s*resumeRefreshPendingRef\.current = false;\s*\}/,
  );
  assert.match(
    homeSource,
    /homeFocusedRef\.current = false;\s*resumeRefreshPendingRef\.current = false;/,
  );
});

test("Home coalesces paired requests and releases the shared request after success or failure", async () => {
  const singleFlight = createHomeRefreshSingleFlight();
  const deferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
  };
  let requestCount = 0;

  const firstRequest = deferred();
  const first = singleFlight.run(() => {
    requestCount += 1;
    return firstRequest.promise;
  });
  const simultaneous = singleFlight.run(async () => {
    requestCount += 1;
    return "unexpected duplicate";
  });
  assert.equal(first, simultaneous, "Concurrent callers must share the same promise.");
  assert.equal(requestCount, 1, "Only one paired request may be started for concurrent callers.");
  firstRequest.resolve("latest snapshot");
  assert.equal(await first, "latest snapshot");

  const failed = singleFlight.run(async () => {
    requestCount += 1;
    throw new Error("paired request failed");
  });
  const simultaneousFailure = singleFlight.run(async () => {
    requestCount += 1;
    return "unexpected recovery";
  });
  assert.equal(failed, simultaneousFailure, "Concurrent callers must share a failing request too.");
  await assert.rejects(failed, /paired request failed/);
  assert.equal(
    await singleFlight.run(async () => {
      requestCount += 1;
      return "recovered snapshot";
    }),
    "recovered snapshot",
    "A settled failure must release the gate for the next refresh.",
  );
  assert.equal(requestCount, 3, "Success, shared failure, and recovery each start one paired request.");
});

test("Home shows successful refresh times in IST", () => {
  assert.equal(
    formatHomeRefreshTimestamp(Date.parse("2026-10-09T10:00:00.000Z")),
    "09 Oct 2026, 03:30 pm IST",
  );

  const healthyTimestamp = homeSource.match(
    /\{!loading && !loadError && lastSuccessfulRefreshAt !== null && \([\s\S]*?testID="home-last-updated"[\s\S]*?\n\s*\)\}/,
  )?.[0];
  assert.ok(
    healthyTimestamp,
    "Home must show the last successful paired refresh time when its data is healthy.",
  );
  assert.match(
    healthyTimestamp,
    /Last updated \{formatHomeRefreshTimestamp\(lastSuccessfulRefreshAt\)\}/,
    "The healthy timestamp must use the same IST formatter as the stale-data warning.",
  );
  assert.match(
    healthyTimestamp,
    /accessibilityLabel=\{`Tournament and registration data last updated \$\{formatHomeRefreshTimestamp\(lastSuccessfulRefreshAt\)\}`\}/,
    "Screen readers must identify what the timestamp describes.",
  );
  assert.doesNotMatch(
    healthyTimestamp,
    /api\.(?:tournaments|myRegistrations)\(/,
    "Showing the timestamp must not add API calls.",
  );
});

test("out-of-order Home refreshes keep the newest paired snapshot and successful update time", async () => {
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
  let currentTime = 100;
  let lastSuccessfulRefreshAt = 50;
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
    lastSuccessfulRefreshAt = currentTime;
  };

  const olderRegistration = deferred();
  const olderRequestId = guard.start();
  const olderRefresh = applyPairedRefresh(
    olderRequestId,
    Promise.resolve(["older tournament"]),
    olderRegistration.promise,
  );

  const newerRequestId = guard.start();
  currentTime = 200;
  await applyPairedRefresh(
    newerRequestId,
    Promise.resolve(["newer tournament"]),
    Promise.resolve(["newer registration"]),
  );
  currentTime = 300;
  olderRegistration.resolve(["older registration"]);
  await olderRefresh;

  assert.deepEqual(visibleSnapshot, {
    tournaments: ["newer tournament"],
    registrations: ["newer registration"],
  });
  assert.equal(visibleError, "");
  assert.equal(lastSuccessfulRefreshAt, 200);

  const olderRegistrationAfterFailure = deferred();
  const olderRequestAfterFailureId = guard.start();
  const olderRefreshAfterFailure = applyPairedRefresh(
    olderRequestAfterFailureId,
    Promise.resolve(["stale tournament"]),
    olderRegistrationAfterFailure.promise,
  );
  const newerFailureRequestId = guard.start();
  currentTime = 400;
  await applyPairedRefresh(
    newerFailureRequestId,
    Promise.reject(new Error("newest request failed")),
    Promise.resolve(["newer registration"]),
  );
  assert.equal(visibleError, "Could not load tournaments.");
  assert.equal(lastSuccessfulRefreshAt, 200, "A failed pair must not advance the last-successful time.");
  currentTime = 500;
  olderRegistrationAfterFailure.resolve(["stale registration"]);
  await olderRefreshAfterFailure;
  assert.deepEqual(visibleSnapshot, {
    tournaments: ["newer tournament"],
    registrations: ["newer registration"],
  });
  assert.equal(visibleError, "Could not load tournaments.");
  assert.equal(lastSuccessfulRefreshAt, 200, "A stale success must not advance the last-successful time.");

  const registrationFailureRequestId = guard.start();
  currentTime = 600;
  await applyPairedRefresh(
    registrationFailureRequestId,
    Promise.resolve(["latest tournament"]),
    Promise.reject(new Error("registration request failed")),
  );
  assert.equal(visibleError, "Could not load tournaments.");
  assert.equal(lastSuccessfulRefreshAt, 200, "A registration failure must not advance the last-successful time.");

  const loadStart = homeSource.indexOf("const load = useCallback(() =>");
  const loadEnd = homeSource.indexOf("\n  }, []);", loadStart);
  const loadMethod = homeSource.slice(loadStart, loadEnd);
  assert.ok(loadMethod, "Home must define its paired refresh loader.");
  assert.match(loadMethod, /loadSingleFlightRef\.current\.run\(async \(\) => \{/);
  assert.match(loadMethod, /const requestId = loadRequestGuardRef\.current\.start\(\)/);
  assert.match(loadMethod, /Promise\.allSettled/);
  const staleResponseGuard = loadMethod.indexOf(
    "if (!loadRequestGuardRef.current.isCurrent(requestId)) return;",
  );
  const tournamentFailure = loadMethod.indexOf(
    "if (tournamentsResult.status === 'rejected') throw tournamentsResult.reason;",
  );
  const registrationsFailure = loadMethod.indexOf(
    "if (registrationsResult.status === 'rejected') throw registrationsResult.reason;",
  );
  const registrationsValidation = loadMethod.indexOf("if (!Array.isArray(registrations))");
  const applyItems = loadMethod.indexOf("setItems(");
  const applyTimestamp = loadMethod.indexOf("setLastSuccessfulRefreshAt(successfulRefreshAt)");
  assert.ok(
    staleResponseGuard >= 0 &&
      staleResponseGuard < tournamentFailure &&
      tournamentFailure < registrationsFailure &&
      registrationsFailure < registrationsValidation &&
      registrationsValidation < applyItems &&
      applyItems < applyTimestamp,
    "Only the current fully successful paired response may update the visible-card timestamp.",
  );
  assert.match(loadMethod, /const successfulRefreshAt = Date\.now\(\)/);
  assert.match(loadMethod, /setClockNow\(successfulRefreshAt\)/);
  assert.match(loadMethod, /if \(loadRequestGuardRef\.current\.isCurrent\(requestId\)\) \{\s*setLoadError/);
  assert.match(loadMethod, /if \(loadRequestGuardRef\.current\.isCurrent\(requestId\)\) setLoading\(false\)/);
  assert.match(
    loadMethod,
    /return loadPromise\.finally\(\(\) => \{[\s\S]*?resumeRefreshPendingRef\.current = false;[\s\S]*?refreshHomeIfIdleRef\.current\(\)/,
    "A refresh queued behind a direct request must start after the shared request settles.",
  );
});

test("malformed registration refresh preserves confirmed Home cards until valid data arrives", async () => {
  let tournaments = [
    { id: "joined-match", title: "Confirmed match", status: "upcoming" },
  ];
  let registrations = [
    { tournamentId: "joined-match", status: "approved" },
  ];
  const api = {
    tournaments: async () => tournaments,
    myRegistrations: createSharedMyRegistrations({
      get: async () => registrations,
    }),
  };
  const harness = createHomeLoadHarness(api);

  await harness.load();
  const confirmedItems = harness.state.items;
  assert.equal(confirmedItems.length, 1);
  assert.equal(confirmedItems[0].title, "Confirmed match");
  assert.equal(confirmedItems[0].joined, true);
  assert.equal(harness.state.loadError, "");
  assert.equal(harness.state.loading, false);
  const confirmedRefreshAt = harness.state.lastSuccessfulRefreshAt;
  assert.equal(typeof confirmedRefreshAt, "number");

  tournaments = [
    { id: "joined-match", title: "Updated match", status: "upcoming" },
    { id: "new-match", title: "New match", status: "upcoming" },
  ];
  registrations = { malformed: true };
  await harness.load();

  assert.strictEqual(
    harness.state.items,
    confirmedItems,
    "Malformed shared API data must not replace Home's last confirmed tournament snapshot.",
  );
  assert.equal(harness.state.items[0].joined, true, "The confirmed joined indicator must remain visible.");
  assert.equal(harness.state.items[0].title, "Confirmed match");
  assert.equal(harness.state.loadError, "Invalid registrations response.");
  assert.equal(harness.state.loading, false);
  assert.equal(
    harness.state.lastSuccessfulRefreshAt,
    confirmedRefreshAt,
    "A malformed registration response must not advance the successful-refresh timestamp.",
  );

  registrations = [];
  await harness.load();

  assert.notStrictEqual(harness.state.items, confirmedItems);
  assert.deepEqual(
    harness.state.items.map((tournament) => ({
      id: tournament.id,
      title: tournament.title,
      joined: tournament.joined,
    })),
    [
      { id: "joined-match", title: "Updated match", joined: false },
      { id: "new-match", title: "New match", joined: false },
    ],
    "A later valid paired response should update tournament details and joined indicators.",
  );
  assert.equal(harness.state.loadError, "", "A valid refresh should clear the issue.");
  assert.ok(harness.state.lastSuccessfulRefreshAt >= confirmedRefreshAt);
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

test("Home announces failed upcoming refreshes and exposes a named, busy-aware TalkBack retry", () => {
  const refreshFailureNotice = homeSource.match(
    /\{!loading && upcomingItems\.length > 0 && Boolean\(loadError\) && \([\s\S]*?testID="home-upcoming-refresh-error"[\s\S]*?\n\s*\)\}/,
  )?.[0];

  assert.ok(refreshFailureNotice, "A failed refresh with visible cards must show an inline notice.");
  assert.ok(
    refreshFailureNotice.includes("text={staleCardWarning}"),
    "The visible warning must explain that refresh failed and include when its cards last updated.",
  );
  assert.ok(
    refreshFailureNotice.includes("accessibilityLabel={staleCardWarning}"),
    "TalkBack must receive the complete warning, including the last update time.",
  );
  assert.match(
    homeSource,
    /const staleCardWarning =\s*`Could not refresh tournaments\. The cards shown may be out of date\. \$\{loadError\} \$\{lastSuccessfulUpdateText\}`/,
    "The stale-card warning must include the last successful update text.",
  );
  assert.match(homeSource, /Last successful update: \$\{formatHomeRefreshTimestamp\(lastSuccessfulRefreshAt\)\}\./);
  assert.match(homeSource, /The last successful update time is unavailable\./);
  assert.match(refreshFailureNotice, /accessibilityLiveRegion="polite"/);
  assert.equal(
    (refreshFailureNotice.match(/accessibilityLiveRegion=/g) ?? []).length,
    1,
    "The warning must use a single polite live region.",
  );
  assert.match(refreshFailureNotice, /testID="home-upcoming-retry"/);
  assert.match(refreshFailureNotice, /accessibilityRole="button"/);
  assert.match(refreshFailureNotice, /onPress=\{onRefresh\}/);
  assert.match(refreshFailureNotice, /disabled=\{refreshing\}/);
  assert.match(
    refreshFailureNotice,
    /accessibilityLabel=\{refreshing \? 'Retrying tournament refresh' : 'Retry tournament refresh'\}/,
  );
  assert.match(
    refreshFailureNotice,
    /accessibilityHint="Loads the latest tournament cards and registration status\."/,
  );
  assert.match(
    refreshFailureNotice,
    /accessibilityState=\{\{ disabled: refreshing, busy: refreshing \}\}/,
    "TalkBack must get both the unavailable and in-progress states during retry.",
  );
  assert.match(refreshFailureNotice, /RETRYING…/);
  assert.ok(
    homeSource.indexOf('testID="home-upcoming-refresh-error"') <
      homeSource.indexOf('testID="home-upcoming-carousel"'),
    "The refresh notice must render without replacing the carousel.",
  );

  const loadStart = homeSource.indexOf("const load = useCallback(() =>");
  const loadEnd = homeSource.indexOf("\n  }, []);", loadStart);
  const loadMethod = homeSource.slice(loadStart, loadEnd);
  const loadFailure = loadMethod?.match(/catch \(e: any\) \{([\s\S]*?)\n\s*\} finally/)?.[1];
  assert.ok(loadFailure, "Home must retain an explicit refresh-failure handler.");
  assert.match(loadFailure, /setLoadError/);
  assert.doesNotMatch(loadFailure, /setItems/, "A failed refresh must not clear existing cards.");

  const refreshHandler = homeSource.match(
    /const onRefresh = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  assert.match(refreshHandler ?? "", /await load\(\)/);
});

test("Home offers a direct retry and keeps tournament-list navigation when no cards load", () => {
  const emptyStateStart = homeSource.indexOf("upcomingItems.length === 0 ? (");
  const carouselStart = homeSource.indexOf('testID="home-upcoming-carousel"', emptyStateStart);
  assert.ok(emptyStateStart >= 0 && carouselStart > emptyStateStart);
  const emptyState = homeSource.slice(emptyStateStart, carouselStart);

  assert.match(emptyState, /loadError \? \(\s*<View testID="home-empty-load-error"/);
  assert.match(emptyState, /title="TOURNAMENTS UNAVAILABLE"/);
  assert.match(
    emptyState,
    /Could not load tournament cards\.\s*\$\{loadError\}[\s\S]*?accessibilityLiveRegion="polite"/,
  );
  assert.match(
    emptyState,
    /testID="home-empty-retry"[\s\S]*?onPress=\{onRefresh\}[\s\S]*?disabled=\{refreshing\}[\s\S]*?accessibilityState=\{\{ disabled: refreshing, busy: refreshing \}\}/,
  );
  assert.match(emptyState, /refreshing \? 'Retrying tournament refresh' : 'Retry tournament refresh'/);
  assert.match(emptyState, /refreshing \? 'RETRYING…' : 'RETRY HOME'/);
  assert.match(
    emptyState,
    /testID="home-empty-check-matches"[\s\S]*?goTab\('tournaments'\)[\s\S]*?CHECK MATCHES/,
  );
  assert.match(
    emptyState,
    /\) : \(\s*<Empty[\s\S]*?actionLabel="CHECK MATCHES"[\s\S]*?goTab\('tournaments'\)/,
    "A successful empty response must still link to the tournament list.",
  );
  assert.match(uiSource, /title = 'NO MATCHES LIVE'/);
  assert.match(uiSource, /title\?: string; text: string/);
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