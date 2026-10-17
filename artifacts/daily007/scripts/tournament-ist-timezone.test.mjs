import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRoomCredentialSchedule } from "../src/lib/roomCredentialTiming.ts";
import { getTournamentLifecycleState } from "../src/lib/tournamentLifecycle.ts";

const [homeSource, myMatchesSource, detailSource] = await Promise.all([
  readFile(new URL("../src/screens/Home.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/MyMatches.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/TDetail.tsx", import.meta.url), "utf8"),
]);

test("all tournament screens show the canonical IST date and time", () => {
  const start = "2029-12-31T17:00:00Z";
  const schedule = getRoomCredentialSchedule(start);

  assert.deepEqual(schedule && {
    date: schedule.date,
    startTime24: schedule.startTime24,
  }, {
    date: "31 DEC 2029",
    startTime24: "22:30",
  });
  const hour = Number(schedule.startTime24.slice(0, 2));
  assert.equal(
    `${hour % 12 || 12}:${schedule.startTime24.slice(3)} ${hour >= 12 ? "PM" : "AM"}`,
    "10:30 PM",
  );

  assert.match(
    homeSource,
    /const schedule = getRoomCredentialSchedule\(t\.startsAt\);[\s\S]*?schedule\?\.date \?\? fmtDate\(t\.date\)[\s\S]*?fmtTime12\(schedule\?\.startTime24 \?\? t\.time\)\}\s*IST/,
    "Home must use the canonical start timestamp for both visible date and time",
  );
  assert.match(
    myMatchesSource,
    /const schedule = getRoomCredentialSchedule\(startsAt\);[\s\S]*?schedule\?\.date \?\? fmtDate\(t\.date\)[\s\S]*?fmtTime12\(schedule\?\.startTime24 \?\? t\.time\)\}\s*IST/,
    "My Matches must use the canonical start timestamp for both visible date and time",
  );
  assert.match(
    detailSource,
    /const schedule = getRoomCredentialSchedule\(t\.startsAt\);[\s\S]*?\$\{schedule\.date\} · \$\{fmtTime12\(schedule\.startTime24\)\} IST/,
    "Tournament Details must use the canonical start timestamp for both visible date and time",
  );
});

test("Pacific/Kiritimati device dates cannot shift the displayed tournament schedule", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";

  try {
    assert.equal(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
      "Pacific/Kiritimati",
      "the test runtime must actually use the ahead-of-IST device timezone",
    );
    const start = "2029-12-31T17:00:00Z";
    const schedule = getRoomCredentialSchedule(start);
    assert.ok(schedule);
    assert.equal(schedule.date, "31 DEC 2029");
    assert.equal(schedule.startTime24, "22:30");

    const tournament = { startsAt: start, status: "upcoming" };
    const startMs = Date.parse(start);
    assert.equal(getTournamentLifecycleState(tournament, startMs - 1), "upcoming");
    assert.equal(getTournamentLifecycleState(tournament, startMs), "ongoing");
    assert.equal(getTournamentLifecycleState(tournament, startMs + 1), "ongoing");

    assert.match(homeSource, /getUpcomingHomeTournaments\(items, clockNow\)/);
    assert.match(myMatchesSource, /getTournamentLifecycleState\(r\.tournament, clockNow\)/);
    assert.match(detailSource, /getTournamentLifecycleState\(t, clockNow\)/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
