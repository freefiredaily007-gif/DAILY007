import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { didAppReturnToForeground } from "../src/lib/tournamentLifecycle.ts";

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
});
