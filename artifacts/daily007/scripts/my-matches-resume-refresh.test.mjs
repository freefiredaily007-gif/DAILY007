import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { didAppReturnToForeground } from "../src/lib/tournamentLifecycle.ts";
import { createFocusedLatestRequestGate } from "../src/lib/focusedLatestRequest.ts";
import {
  createFocusedRetryController,
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
  assert.match(myMatchesSource, /if \(usable && refreshAfterFailure\) refreshMatches\(\);/);
  assert.match(myMatchesSource, /networkSubscription\.remove\(\);/);
  const focusEffect = myMatchesSource.match(
    /useFocusEffect\(useCallback\(\(\) => \{([\s\S]*?)\n\s*\}, \[[^\]]+\]\)\);/,
  )?.[1] ?? "";
  assert.match(focusEffect, /registrationRequests\.setFocused\(true\)/);
  assert.match(focusEffect, /registrationRequests\.setFocused\(false\)/);
  assert.match(focusEffect, /retryController\.setFocused\(true\)/);
  assert.match(focusEffect, /retryController\.setFocused\(false\)/);
  assert.match(focusEffect, /Network\.addNetworkStateListener/);
  assert.match(focusEffect, /Network\.getNetworkStateAsync\(\)/);
  assert.match(focusEffect, /networkEventRevision \+= 1;/);
  assert.match(
    focusEffect,
    /networkEventRevision !== initialNetworkEventRevision/,
    "A delayed initial network snapshot must not overwrite a newer network event.",
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

test("My Matches only treats a connected network with no known reachability failure as usable", () => {
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: null }), true);
  assert.equal(isUsableNetworkState({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(isUsableNetworkState({ isConnected: false, isInternetReachable: true }), false);
  assert.equal(isUsableNetworkState({ isConnected: null, isInternetReachable: null }), false);
});
