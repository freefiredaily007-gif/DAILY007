import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  startDaily007AutoCancellationScheduler,
} from "../src/lib/daily007-tournament-auto-cancel";
import {
  startDaily007TournamentCleanupScheduler,
} from "../src/lib/daily007-tournament-cleanup";
import { daily007SchedulerTestDb } from "./support/daily007-scheduler-test-db";

test("API startup keeps tournament cancellation and cleanup schedulers inactive", () => {
  const startupSource = readFileSync("src/index.ts", "utf8");

  assert.doesNotMatch(startupSource, /daily007-tournament-auto-cancel/);
  assert.doesNotMatch(startupSource, /daily007-tournament-cleanup/);
  assert.match(startupSource, /startDaily007LeaderboardScheduler\(\)/);
});

test("retained tournament scheduler entry points create no timers or database work", (t) => {
  daily007SchedulerTestDb.queryCalls = 0;
  daily007SchedulerTestDb.connectCalls = 0;

  let timeoutCalls = 0;
  let intervalCalls = 0;
  let immediateCalls = 0;

  t.mock.method(globalThis, "setTimeout", (() => {
    timeoutCalls += 1;
    return {} as NodeJS.Timeout;
  }) as typeof globalThis.setTimeout);
  t.mock.method(globalThis, "setInterval", (() => {
    intervalCalls += 1;
    return { unref() {} } as NodeJS.Timeout;
  }) as typeof globalThis.setInterval);
  t.mock.method(globalThis, "setImmediate", (() => {
    immediateCalls += 1;
    return {} as NodeJS.Immediate;
  }) as typeof globalThis.setImmediate);

  startDaily007AutoCancellationScheduler();
  startDaily007TournamentCleanupScheduler();

  assert.equal(timeoutCalls, 0);
  assert.equal(intervalCalls, 0);
  assert.equal(immediateCalls, 0);
  assert.equal(daily007SchedulerTestDb.queryCalls, 0);
  assert.equal(daily007SchedulerTestDb.connectCalls, 0);
});
