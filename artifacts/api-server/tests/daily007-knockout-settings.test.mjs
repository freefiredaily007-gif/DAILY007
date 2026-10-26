import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KNOCKOUT_SETTINGS,
  knockoutStages,
  parseKnockoutSettings,
} from "../src/lib/daily007-knockout.ts";

const now = Date.parse("2026-10-26T12:00:00.000Z");

function settings(overrides = {}) {
  return {
    title: DEFAULT_KNOCKOUT_SETTINGS.title,
    startsAt: "2026-10-30T14:30:00.000Z",
    squadCount: 12,
    playersPerSquad: 4,
    stageCount: 3,
    entryCoins: 10,
    prizePool: 1000,
    pointsPerKill: 1,
    round1Eliminated: 2,
    round2Eliminated: 2,
    published: false,
    ...overrides,
  };
}

test("default Knockout settings produce the requested 12 → 10 → 8 stages", () => {
  assert.equal(DEFAULT_KNOCKOUT_SETTINGS.squadCount, 12);
  assert.equal(DEFAULT_KNOCKOUT_SETTINGS.playersPerSquad, 4);
  assert.equal(DEFAULT_KNOCKOUT_SETTINGS.stageCount, 3);
  assert.deepEqual(knockoutStages(12, 2, 2), [
    { name: "Round 1", squads: 12, eliminated: 2, advance: 10 },
    { name: "Round 2", squads: 10, eliminated: 2, advance: 8 },
    { name: "Final", squads: 8, eliminated: 0, advance: 8 },
  ]);
});

test("admin settings allow smaller squad counts only when every stage still advances finalists", () => {
  const parsed = parseKnockoutSettings(settings({
    squadCount: 4,
    round1Eliminated: 1,
    round2Eliminated: 1,
  }), { now });
  assert.deepEqual(knockoutStages(
    parsed.squadCount,
    parsed.round1Eliminated,
    parsed.round2Eliminated,
  ).map((stage) => stage.advance), [3, 2, 2]);
});

test("invalid capacity, elimination totals, fractional coins, and past starts are rejected", () => {
  assert.throws(() => parseKnockoutSettings(settings({ squadCount: 3 }), { now }), /Total squads/);
  assert.throws(() => parseKnockoutSettings(settings({ round1Eliminated: 10 }), { now }), /Round 1 eliminations/);
  assert.throws(() => parseKnockoutSettings(settings({ round2Eliminated: 9 }), { now }), /Round 2 eliminations/);
  assert.throws(() => parseKnockoutSettings(settings({ entryCoins: 10.5 }), { now }), /Entry fee/);
  assert.throws(() => parseKnockoutSettings(settings({ startsAt: "2026-10-25T00:00:00.000Z" }), { now }), /future/);
});

test("players per squad and stage count are fixed to four and three", () => {
  assert.throws(() => parseKnockoutSettings(settings({ playersPerSquad: 3 }), { now }), /Players per squad/);
  assert.throws(() => parseKnockoutSettings(settings({ stageCount: 2 }), { now }), /Stages/);
});
