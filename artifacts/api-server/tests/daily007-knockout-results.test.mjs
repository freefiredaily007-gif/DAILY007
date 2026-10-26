import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateKnockoutRoundPoints,
  isKnockoutSquadConfirmed,
  knockoutPaymentStatus,
  knockoutPlacementPoints,
  parseKnockoutRoundResult,
} from "../src/lib/daily007-knockout-results.ts";

test("Knockout placement schedule matches all twelve requested positions", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => knockoutPlacementPoints(index + 1)),
    [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0],
  );
});

test("round points are placement points plus the squad kill total once", () => {
  assert.equal(calculateKnockoutRoundPoints(3, 5, 1), 13);
  assert.equal(calculateKnockoutRoundPoints(1, 4, 2), 20);
  assert.equal(calculateKnockoutRoundPoints(11, 7, 1), 7);
});

test("result input accepts only known rounds and bounded whole-number values", () => {
  assert.deepEqual(parseKnockoutRoundResult({
    round: "round_1", teamNumber: 12, placement: 11, squadKills: 0,
  }), { round: "round_1", teamNumber: 12, placement: 11, squadKills: 0 });
  for (const invalid of [
    { round: "semifinal", teamNumber: 1, placement: 1, squadKills: 0 },
    { round: "final", teamNumber: 13, placement: 1, squadKills: 0 },
    { round: "round_2", teamNumber: 1, placement: 1.5, squadKills: 0 },
    { round: "round_1", teamNumber: 1, placement: 1, squadKills: -1 },
    { round: "final", teamNumber: 1, placement: 1, squadKills: 100001 },
    { round: "round_1", teamNumber: "1", placement: 1, squadKills: 0 },
  ]) {
    assert.equal(parseKnockoutRoundResult(invalid), null);
  }
});

test("a squad is confirmed only with four approved, fully paid distinct slots", () => {
  const fullPaidSquad = [1, 2, 3, 4].map((slotNumber) => ({
    slotNumber,
    registrationStatus: "approved",
    entryCoinsPaid: 10,
  }));
  assert.equal(isKnockoutSquadConfirmed(fullPaidSquad, 10), true);
  assert.equal(isKnockoutSquadConfirmed(fullPaidSquad.slice(0, 3), 10), false);
  assert.equal(isKnockoutSquadConfirmed([
    ...fullPaidSquad.slice(0, 3),
    { slotNumber: 4, registrationStatus: "pending", entryCoinsPaid: 10 },
  ], 10), false);
  assert.equal(isKnockoutSquadConfirmed([
    ...fullPaidSquad.slice(0, 3),
    { slotNumber: 4, registrationStatus: "approved", entryCoinsPaid: 9 },
  ], 10), false);
  assert.equal(isKnockoutSquadConfirmed([
    ...fullPaidSquad.slice(0, 3),
    { slotNumber: 3, registrationStatus: "approved", entryCoinsPaid: 10 },
  ], 10), false);
});

test("slot payment labels distinguish open, pending, unpaid, and paid states", () => {
  assert.equal(knockoutPaymentStatus({
    slotNumber: 1, registrationStatus: null, entryCoinsPaid: 0, hasMember: false,
  }, 10), "open");
  assert.equal(knockoutPaymentStatus({
    slotNumber: 1, registrationStatus: "pending", entryCoinsPaid: 10, hasMember: true,
  }, 10), "pending");
  assert.equal(knockoutPaymentStatus({
    slotNumber: 1, registrationStatus: "approved", entryCoinsPaid: 9, hasMember: true,
  }, 10), "unpaid");
  assert.equal(knockoutPaymentStatus({
    slotNumber: 1, registrationStatus: "approved", entryCoinsPaid: 10, hasMember: true,
  }, 10), "paid");
});
