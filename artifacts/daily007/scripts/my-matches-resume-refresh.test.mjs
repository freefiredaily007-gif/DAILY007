import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { didAppReturnToForeground } from "../src/lib/tournamentLifecycle.ts";
import { createFocusedLatestRequestGate } from "../src/lib/focusedLatestRequest.ts";

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
    /networkState\.isConnected === true && networkState\.isInternetReachable !== false/,
  );
  assert.match(
    myMatchesSource,
    /if \(networkState\.isConnected === true && networkState\.isInternetReachable !== false\) \{\s*refreshMatches\(\);/,
  );
  assert.match(myMatchesSource, /networkSubscription\.remove\(\);/);
  const focusEffect = myMatchesSource.match(
    /useFocusEffect\(useCallback\(\(\) => \{([\s\S]*?)\n\s*\}, \[[^\]]+\]\)\);/,
  )?.[1] ?? "";
  assert.match(focusEffect, /registrationRequests\.setFocused\(true\)/);
  assert.match(focusEffect, /registrationRequests\.setFocused\(false\)/);
  assert.match(focusEffect, /Network\.addNetworkStateListener/);
  assert.match(focusEffect, /networkSubscription\.remove\(\)/);
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
