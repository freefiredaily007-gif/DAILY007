import assert from "node:assert/strict";
import test from "node:test";
import { didAppReturnToForeground } from "../src/lib/tournamentLifecycle.ts";

test("My Matches refreshes on background-to-active and inactive-to-active transitions", () => {
  assert.equal(didAppReturnToForeground("background", "active"), true);
  assert.equal(didAppReturnToForeground("inactive", "active"), true);
  assert.equal(didAppReturnToForeground("active", "active"), false);
  assert.equal(didAppReturnToForeground("background", "inactive"), false);
});
