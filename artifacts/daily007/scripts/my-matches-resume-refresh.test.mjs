import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { didAppReturnToForeground } from "../src/lib/tournamentLifecycle.ts";
import {
  createFocusedLatestRequestGate,
  createFocusedRefreshCoalescer,
} from "../src/lib/focusedLatestRequest.ts";
import {
  createFocusedRetryController,
  createNetworkEventRevision,
  isUsableNetworkState,
} from "../src/lib/focusedRetry.ts";

const myMatchesSource = readFileSync(
  new URL("../src/screens/MyMatches.tsx", import.meta.url),
  "utf8",
);

test("My Matches refreshes on background-to-active and inactive-to-active transitions", () => {
  assert.equal(didAppReturnToForeground("background", "active"), true);
  assert.equal(didAppReturnToForeground("inactive", "active"), true);
  assert.equal(didAppReturnToForeground("active", "active"), false);
  assert.equal(didAppReturnToForeground("background", "inactive"), false);
});

test("My Matches retries registration loading when connectivity returns while focused", () => {
  assert.match(myMatchesSource, /Network\.addNetworkStateListener\(\(networkState\) => \{/);
  assert.match(
    myMatchesSource,
    /const usable = isUsableNetworkState\(networkState\);/,
  );
  assert.match(
    myMatchesSource,
    /if \(usable && refreshAfterFailure\) connectivityRefreshes\.request\(refreshMatches\);/,
  );
  assert.match(myMatchesSource, /connectivityRefreshes\.setFocused\(true\)/);
  assert.match(myMatchesSource, /connectivityRefreshes\.setFocused\(false\)/);
  assert.match(myMatchesSource, /if \(!usable\) connectivityRefreshes\.cancelPending\(\);/);
  assert.match(
    myMatchesSource,
    /const load = useCallback\(async \(\) => \{\s*connectivityRefreshes\.cancelPending\(\);/,
    "Immediate manual and scheduled loads should cancel a not-yet-started automatic refresh.",
  );
  assert.match(myMatchesSource, /networkSubscription\.remove\(\);/);
  assert.match(myMatchesSource, /refreshControl=\{<RefreshControl refreshing=\{loading\} onRefresh=\{load\}/);
  assert.match(myMatchesSource, /setTimeout\(\(\) => \{\s*refreshMatches\(\);/);
  const focusEffect = myMatchesSource.match(
    /useFocusEffect\(useCallback\(\(\) => \{([\s\S]*?)\n\s*\}, \[[^\]]+\]\)\);/,
  )?.[1] ?? "";
  assert.match(focusEffect, /registrationRequests\.setFocused\(true\)/);
  assert.match(focusEffect, /registrationRequests\.setFocused\(false\)/);
  assert.match(focusEffect, /retryController\.setFocused\(true\)/);
  assert.match(focusEffect, /retryController\.setFocused\(false\)/);
  assert.match(focusEffect, /retryController\.setAppActive\(appState\.current === 'active'\)/);
  assert.match(focusEffect, /retryController\.setAppActive\(nextState === 'active'\)/);
  assert.match(
    focusEffect,
    /retryController\.setAppActive\(nextState === 'active'\);[\s\S]*?if \(returnedToApp\) refreshMatches\(\);/,
    "Foreground state should be restored before the immediate return-to-app refresh.",
  );
  assert.match(focusEffect, /Network\.addNetworkStateListener/);
  assert.match(focusEffect, /Network\.getNetworkStateAsync\(\)/);
  assert.match(focusEffect, /networkEventRevision\.recordEvent\(\)/);
  assert.match(
    focusEffect,
    /!networkEventRevision\.isCurrent\(initialNetworkEventRevision\)/,
    "A delayed initial network snapshot must not overwrite a newer network event.",
  );
  assert.match(
    focusEffect,
    /catch\(\(\) => \{\s*if \(active && networkEventRevision\.isCurrent\(initialNetworkEventRevision\)\)\s*\{\s*retryController\.setNetworkUsable\(false\);/,
    "A stale rejected initial network check must not mark a newer event unusable.",
  );
  assert.match(focusEffect, /networkSubscription\.remove\(\)/);
  assert.match(myMatchesSource, /retryController\.setNetworkUsable\(usable\)/);
  assert.match(myMatchesSource, /retryController\.scheduleRetry/);
  assert.match(myMatchesSource, /retryController\.markSuccess\(\)/);
  assert.match(
    myMatchesSource,
    /registrationRequests\.run\(\s*\(\) => Api\.myRegistrations\(\)/,
    "All registration loads must pass through the focused latest-request gate.",
  );
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("a delayed initial network snapshot cannot override a newer offline or online event", async () => {
  for (const scenario of [
    {
      name: "offline listener event",
      listenerState: { isConnected: false, isInternetReachable: false },
      delayedSnapshot: { isConnected: true, isInternetReachable: true },
      wasUsable: true,
      expectedUsable: false,
      expectedRefreshes: 0,
    },
    {
      name: "usable listener event",
      listenerState: { isConnected: true, isInternetReachable: true },
      delayedSnapshot: { isConnected: false, isInternetReachable: false },
      wasUsable: false,
      expectedUsable: true,
      expectedRefreshes: 1,
    },
    {
      name: "usable listener event before initial check rejects",
      listenerState: { isConnected: true, isInternetReachable: true },
      rejectSnapshot: true,
      wasUsable: false,
      expectedUsable: true,
      expectedRefreshes: 1,
    },
  ]) {
    const revision = createNetworkEventRevision();
    const initialRevision = revision.capture();
    const initialSnapshot = deferred();
    const retryScheduler = createFakeScheduler();
    const refreshScheduler = createFakeScheduler();
    const retries = createFocusedRetryController({
      setTimeout: retryScheduler.setTimeout,
      clearTimeout: retryScheduler.clearTimeout,
    });
    const connectivityRefreshes = createFocusedRefreshCoalescer({
      setTimeout: refreshScheduler.setTimeout,
      clearTimeout: refreshScheduler.clearTimeout,
    }, 250);
    retries.setFocused(true);
    retries.setAppActive(true);
    retries.setNetworkUsable(scenario.wasUsable);
    connectivityRefreshes.setFocused(true);
    let networkUsable = scenario.wasUsable;
    let refreshCount = 0;
    const latestLoadFailed = true;
    const updateNetworkState = (state, refreshAfterFailure) => {
      const usable = isUsableNetworkState(state);
      networkUsable = usable;
      retries.setNetworkUsable(usable);
      if (!usable) connectivityRefreshes.cancelPending();
      if (usable && refreshAfterFailure) {
        connectivityRefreshes.request(() => { refreshCount += 1; });
      }
    };
    if (scenario.wasUsable) {
      assert.equal(retries.scheduleRetry(() => {}), 1_000);
    }

    const initialSnapshotWork = initialSnapshot.promise.then((state) => {
      if (!revision.isCurrent(initialRevision)) return;
      updateNetworkState(state, latestLoadFailed);
    }).catch(() => {
      if (!revision.isCurrent(initialRevision)) return;
      networkUsable = false;
      retries.setNetworkUsable(false);
    });
    revision.recordEvent();
    updateNetworkState(scenario.listenerState, true);
    if (scenario.rejectSnapshot) initialSnapshot.reject(new Error("stale initial network failure"));
    else initialSnapshot.resolve(scenario.delayedSnapshot);
    await initialSnapshotWork;

    assert.equal(networkUsable, scenario.expectedUsable, scenario.name);
    if (!scenario.expectedUsable) {
      assert.equal(retries.scheduleRetry(() => {}), null, "offline state must not start a retry");
      assert.deepEqual(retryScheduler.delays, []);
      assert.deepEqual(refreshScheduler.delays, []);
      assert.equal(refreshScheduler.runNext(), false);
    } else {
      assert.equal(retries.scheduleRetry(() => {}), 1_000, "usable connectivity keeps retries eligible");
      assert.deepEqual(refreshScheduler.delays, [250]);
      assert.equal(refreshScheduler.runNext(), true);
      assert.equal(refreshCount, scenario.expectedRefreshes);
      assert.deepEqual(refreshScheduler.delays, []);
    }
  }
});

test("rapid reconnect loads ignore older lists and errors after the newest list succeeds", async () => {
  const gate = createFocusedLatestRequestGate();
  gate.setFocused(true);

  const oldList = deferred();
  const oldError = deferred();
  const newestList = deferred();
  let visibleRegistrations = [];
  let visibleError = "";
  const apply = (result) => {
    if (result.ok) {
      visibleRegistrations = result.value;
      visibleError = "";
    } else {
      visibleError = String(result.error);
    }
  };
  const onStart = () => { visibleError = ""; };

  const oldListRequest = gate.run(() => oldList.promise, onStart, apply);
  const oldErrorRequest = gate.run(() => oldError.promise, onStart, apply);
  const newestRequest = gate.run(() => newestList.promise, onStart, apply);

  const expectedMatches = [{ id: "newest-registration" }];
  newestList.resolve(expectedMatches);
  assert.equal(await newestRequest, true);

  oldError.reject(new Error("stale network failure"));
  assert.equal(await oldErrorRequest, false);
  oldList.resolve([{ id: "older-registration" }]);
  assert.equal(await oldListRequest, false);

  assert.deepEqual(visibleRegistrations, expectedMatches);
  assert.equal(visibleError, "");
});

test("unfocused My Matches does not retry and ignores a response after blur", async () => {
  const gate = createFocusedLatestRequestGate();
  let requestCount = 0;
  let appliedCount = 0;
  const pending = deferred();

  assert.equal(
    await gate.run(
      async () => {
        requestCount += 1;
        return [];
      },
      () => {},
      () => { appliedCount += 1; },
    ),
    false,
  );
  assert.equal(requestCount, 0);

  gate.setFocused(true);
  const inFlight = gate.run(
    () => {
      requestCount += 1;
      return pending.promise;
    },
    () => {},
    () => { appliedCount += 1; },
  );
  gate.setFocused(false);
  pending.resolve([{ id: "late-registration" }]);

  assert.equal(await inFlight, false);
  assert.equal(requestCount, 1);
  assert.equal(appliedCount, 0);

  gate.setFocused(true);
  assert.equal(
    await gate.run(
      async () => {
        requestCount += 1;
        return [{ id: "focused-again" }];
      },
      () => {},
      () => { appliedCount += 1; },
    ),
    true,
  );
  assert.equal(requestCount, 2);
  assert.equal(appliedCount, 1);
});

function createFakeScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    get delays() {
      return [...timers.values()].map((timer) => timer.delayMs);
    },
    runNext() {
      const first = timers.entries().next().value;
      if (!first) return false;
      const [id, timer] = first;
      timers.delete(id);
      timer.callback();
      return true;
    },
  };
}

test("connectivity bursts coalesce during delayed loads and stay focused", async () => {
  const scheduler = createFakeScheduler();
  const refreshes = createFocusedRefreshCoalescer({
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  }, 250);
  const firstResponse = deferred();
  let requestCount = 0;
  const refresh = () => {
    requestCount += 1;
    if (requestCount === 1) return firstResponse.promise;
  };

  assert.equal(refreshes.request(refresh), false);
  refreshes.setFocused(true);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(refreshes.request(refresh), true);
  }
  assert.deepEqual(scheduler.delays, [250]);
  assert.equal(scheduler.runNext(), true);
  assert.equal(requestCount, 1);

  for (let index = 0; index < 10; index += 1) {
    refreshes.request(refresh);
  }
  assert.deepEqual(scheduler.delays, [250]);
  assert.equal(scheduler.runNext(), true);
  assert.equal(requestCount, 1, "a delayed request must not overlap a connectivity follow-up");

  firstResponse.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestCount, 2, "events during the delayed request should produce one follow-up");
  assert.deepEqual(scheduler.delays, []);

  refreshes.request(refresh);
  assert.deepEqual(scheduler.delays, [250]);
  refreshes.setFocused(false);
  assert.deepEqual(scheduler.delays, [], "blur should cancel a queued automatic refresh");
  assert.equal(scheduler.runNext(), false);
  assert.equal(refreshes.request(refresh), false);
  assert.equal(requestCount, 2);
});

test("an old focused request cannot block a new session's connectivity refresh", async () => {
  const scheduler = createFakeScheduler();
  const refreshes = createFocusedRefreshCoalescer({
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  }, 250);
  const oldResponse = deferred();
  const newResponse = deferred();
  let requestCount = 0;
  const refresh = () => {
    requestCount += 1;
    return requestCount === 1 ? oldResponse.promise : newResponse.promise;
  };

  refreshes.setFocused(true);
  refreshes.request(refresh);
  scheduler.runNext();
  assert.equal(requestCount, 1);

  refreshes.setFocused(false);
  refreshes.setFocused(true);
  refreshes.request(refresh);
  scheduler.runNext();
  assert.equal(requestCount, 2);

  oldResponse.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestCount, 2, "the blurred request must not alter the new focus session's lock");
  newResponse.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test("failed loads retry with capped backoff and success stops the retry timer", () => {
  const scheduler = createFakeScheduler();
  const retries = createFocusedRetryController({
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });
  let retryCount = 0;
  retries.setFocused(true);
  retries.setNetworkUsable(true);

  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), delay);
    assert.deepEqual(scheduler.delays, [delay]);
    assert.equal(scheduler.runNext(), true);
  }
  assert.equal(retryCount, 7);

  assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), 30_000);
  retries.markSuccess();
  assert.deepEqual(scheduler.delays, []);
  assert.equal(scheduler.runNext(), false);
  assert.equal(retryCount, 7);

  assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), 1_000);
});

test("failed loads stop retrying when connectivity is unusable or My Matches loses focus", () => {
  const scheduler = createFakeScheduler();
  const retries = createFocusedRetryController({
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });
  let retryCount = 0;
  retries.setFocused(true);
  retries.setNetworkUsable(true);
  retries.scheduleRetry(() => { retryCount += 1; });
  retries.setNetworkUsable(false);
  assert.deepEqual(scheduler.delays, []);
  assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), null);

  retries.setNetworkUsable(true);
  retries.scheduleRetry(() => { retryCount += 1; });
  retries.setFocused(false);
  assert.deepEqual(scheduler.delays, []);
  assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), null);
  assert.equal(scheduler.runNext(), false);
  assert.equal(retryCount, 0);
});

test("background and inactive AppState cancel retries and active recovery requires usable connectivity", () => {
  for (const inactiveState of ["background", "inactive"]) {
    const scheduler = createFakeScheduler();
    const retries = createFocusedRetryController({
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
    });
    let retryCount = 0;
    const setAppState = (state) => retries.setAppActive(state === "active");
    retries.setFocused(true);
    retries.setNetworkUsable(true);
    setAppState("active");
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), 1_000);

    setAppState(inactiveState);
    assert.deepEqual(scheduler.delays, [], `${inactiveState} should cancel the pending retry`);
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), null);
    assert.equal(scheduler.runNext(), false);
    assert.equal(retryCount, 0);

    setAppState("active");
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), 1_000);
    assert.equal(scheduler.runNext(), true);
    assert.equal(retryCount, 1);

    retries.setNetworkUsable(false);
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), null);
    retries.setNetworkUsable(true);
    assert.equal(retries.scheduleRetry(() => { retryCount += 1; }), 1_000);
    assert.equal(scheduler.runNext(), true);
    assert.equal(retryCount, 2);
  }
});

test("My Matches only treats a connected network with no known reachability failure as usable", () => {
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: null }), true);
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(isUsableNetworkState({ isConnected: false, isInternetReachable: true }), false);
  assert.equal(isUsableNetworkState({ isConnected: null, isInternetReachable: null }), false);
});
