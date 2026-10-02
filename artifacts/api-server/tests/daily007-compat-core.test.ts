import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveWithinCapacity,
  legacyMode,
  matchCapacityState,
  parseOptionalReferralCode,
  parseStart,
  referralSignupStatus,
} from "../src/routes/daily007-compat-core.ts";

test("legacy tournament modes map to the fixed v2 mode capacities", () => {
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Solo" }), "solo");
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Squad" }), "squad");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Squad" }), "clash");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Solo" }), "clash");
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Duo" }), "squad");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Duo" }), "clash");
  assert.equal(legacyMode({ mode: "Lone Wolf", teamType: "Solo" }), "clash");
});

test("legacy date and time inputs are validated and stored as future UTC instants", () => {
  assert.equal(parseStart("2999-03-15", "08:00 PM")?.toISOString(), "2999-03-15T20:00:00.000Z");
  assert.equal(parseStart("2999-03-15", "20:00")?.toISOString(), "2999-03-15T20:00:00.000Z");
  assert.equal(parseStart("2999-02-30", "08:00 PM"), null);
  assert.equal(parseStart("2999-03-15", "25:00"), null);
  assert.equal(parseStart("2000-01-01", "08:00 PM"), null);
});

test("signup referral response stays pending until a separate verification reward flow", () => {
  assert.equal(referralSignupStatus(null), "none");
  assert.equal(referralSignupStatus("D7REFERRAL"), "pending");
  assert.deepEqual(parseOptionalReferralCode(""), { valid: true, code: null });
  assert.deepEqual(parseOptionalReferralCode("  "), { valid: true, code: null });
  assert.deepEqual(parseOptionalReferralCode(" D7REFERRAL "), { valid: true, code: "D7REFERRAL" });
  assert.deepEqual(parseOptionalReferralCode(12), { valid: false, code: null });
});

test("pending approvals consume reserved capacity and full clash matches retain setup-needed status", () => {
  assert.equal(canApproveWithinCapacity(2, 2), true);
  assert.equal(canApproveWithinCapacity(3, 2), false);
  assert.deepEqual(matchCapacityState("clash", 2, 2), { isFull: true, status: "setup_needed" });
  assert.deepEqual(matchCapacityState("squad", 11, 12), { isFull: false, status: "open" });
});