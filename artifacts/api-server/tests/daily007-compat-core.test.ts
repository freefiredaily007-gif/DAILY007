import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveWithinCapacity,
  effectiveTournamentStatus,
  isTeamEditWindowOpen,
  legacyMode,
  matchCapacityState,
  parseTeamEditPayload,
  parseOptionalReferralCode,
  parseStart,
  referralSignupStatus,
} from "../src/routes/daily007-compat-core.ts";
import {
  isTournamentStartInFuture,
  storedTournamentTimeFromInstant,
  tournamentInstantFromStored,
} from "../src/lib/daily007-schedule-time.ts";

test("legacy tournament modes map to the fixed v2 mode capacities", () => {
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Solo" }), "solo");
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Squad" }), "squad");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Squad" }), "clash");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Solo" }), "clash");
  assert.equal(legacyMode({ mode: "Battle Royale", teamType: "Duo" }), "squad");
  assert.equal(legacyMode({ mode: "Clash Squad", teamType: "Duo" }), "clash");
  assert.equal(legacyMode({ mode: "Lone Wolf", teamType: "Solo" }), "clash");
});

test("tournament wall times use IST while timestamps convert to the correct instant", () => {
  const storedWallTime = parseStart("2999-03-15", "08:00 PM");
  assert.equal(storedWallTime?.toISOString(), "2999-03-15T20:00:00.000Z");
  assert.equal(parseStart("2999-03-15", "20:00")?.toISOString(), "2999-03-15T20:00:00.000Z");
  assert.equal(tournamentInstantFromStored(storedWallTime!).toISOString(), "2999-03-15T14:30:00.000Z");
  assert.equal(
    storedTournamentTimeFromInstant(new Date("2999-03-15T14:30:00.000Z")).toISOString(),
    storedWallTime?.toISOString(),
  );
  assert.equal(isTournamentStartInFuture(storedWallTime!, Date.parse("2999-03-15T14:29:59.999Z")), true);
  assert.equal(isTournamentStartInFuture(storedWallTime!, Date.parse("2999-03-15T14:30:00.000Z")), false);
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

test("team editing closes strictly at the 30-minute-before-start cutoff", () => {
  const startsAt = "2030-04-05T12:00:00.000Z";
  const cutoff = Date.parse(startsAt) - 30 * 60 * 1000;
  assert.equal(isTeamEditWindowOpen(startsAt, cutoff - 1), true);
  assert.equal(isTeamEditWindowOpen(startsAt, cutoff), false);
  assert.equal(isTeamEditWindowOpen(startsAt, cutoff + 1), false);
  assert.equal(isTeamEditWindowOpen("not-a-time", cutoff - 1), false);
});

test("team edits require the exact roster and reject duplicate game UIDs", () => {
  assert.deepEqual(
    parseTeamEditPayload({
      captainGameName: "Captain",
      captainGameUid: "100",
      teamName: "Blue",
      teammates: [{ name: "Teammate", uid: "200" }],
    }, 2),
    {
      payload: {
        captainGameName: "Captain",
        captainGameUid: "100",
        teamName: "Blue",
        teammates: [{ name: "Teammate", uid: "200" }],
      },
    },
  );
  assert.match(
    parseTeamEditPayload({ captainGameName: "Captain", captainGameUid: "100", teamName: "Blue", teammates: [] }, 2).error ?? "",
    /exactly 1 teammate/,
  );
  assert.match(
    parseTeamEditPayload({
      captainGameName: "Captain",
      captainGameUid: "100",
      teamName: "Blue",
      teammates: [{ name: "Teammate", uid: "100" }],
    }, 2).error ?? "",
    /different game UID/,
  );
});

test("tournament status moves to Ongoing at start and completes only after the winner is declared", () => {
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: false, enabled: true, status: "open" }), "open");
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: false, enabled: true, status: "full" }), "full");
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: true, enabled: true, status: "full" }), "ongoing");
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: true, enabled: false, status: "full" }), "ongoing");
  assert.equal(effectiveTournamentStatus({ has_winner: true, has_started: true, enabled: true, status: "full" }), "ongoing");
  assert.equal(effectiveTournamentStatus({ has_winner: true, has_started: true, enabled: false, status: "full" }), "completed");
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: false, enabled: false, status: "full" }), "closed");
});