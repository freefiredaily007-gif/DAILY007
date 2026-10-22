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
  tournamentCancellationError,
} from "../src/routes/daily007-compat-core.ts";
import {
  isTournamentStartInFuture,
  storedTournamentTimeFromInstant,
  tournamentInstantFromStored,
} from "../src/lib/daily007-schedule-time.ts";
import {
  isAutomaticTournamentCancellationMode,
  shouldAutomaticallyCancelTournament,
} from "../src/lib/daily007-tournament-cancellation.ts";
import { getTournamentLifecycleState } from "../../daily007/src/lib/tournamentLifecycle";

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

test("API and mobile tournament lists move to Ongoing at the exact scheduled IST start", () => {
  const scheduledInstant = new Date("2999-03-15T14:30:00.000Z");
  const storedWallTime = storedTournamentTimeFromInstant(scheduledInstant);
  const apiStartsAt = tournamentInstantFromStored(storedWallTime).toISOString();
  const tournament = { startsAt: apiStartsAt, status: "open", enabled: true };
  const oneMillisecondBefore = scheduledInstant.getTime() - 1;
  const atStart = scheduledInstant.getTime();
  const hasStartedBefore = !isTournamentStartInFuture(storedWallTime, oneMillisecondBefore);

  assert.equal(hasStartedBefore, false);
  assert.equal(effectiveTournamentStatus({
    has_winner: false,
    has_started: hasStartedBefore,
    enabled: true,
    status: "open",
  }), "open");
  assert.equal(getTournamentLifecycleState(tournament, oneMillisecondBefore), "upcoming");

  const hasStartedAt = !isTournamentStartInFuture(storedWallTime, atStart);
  assert.equal(hasStartedAt, true);
  assert.equal(effectiveTournamentStatus({
    has_winner: false,
    has_started: hasStartedAt,
    enabled: true,
    status: "open",
  }), "ongoing");
  assert.equal(getTournamentLifecycleState(tournament, atStart), "ongoing");
  assert.equal(getTournamentLifecycleState(tournament, atStart + 1), "ongoing");
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
  assert.match(
    parseTeamEditPayload({
      captainGameName: "Captain",
      captainGameUid: "FF-Captain-100",
      teamName: "Blue",
      teammates: [{ name: "Teammate", uid: "ff-captain-100" }],
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
  assert.equal(effectiveTournamentStatus({ has_winner: false, has_started: true, enabled: false, status: "cancelled" }), "cancelled");
});

test("automatic cancellation requires an underfilled started tournament; admin cancellation does not", () => {
  const eligible = {
    status: "full",
    hasStarted: true,
    hasWinner: false,
    filledSlots: 11,
    capacity: 12,
  };
  assert.equal(tournamentCancellationError(eligible), null);
  assert.equal(tournamentCancellationError({ ...eligible, hasStarted: false }), "A tournament can only be cancelled after its scheduled start time.");
  assert.equal(tournamentCancellationError({ ...eligible, filledSlots: 12 }), "Only an ongoing tournament with at least one vacant slot can be cancelled.");
  assert.equal(tournamentCancellationError({ ...eligible, hasWinner: true }), "A tournament with a declared winner cannot be cancelled.");
  assert.equal(tournamentCancellationError({ ...eligible, status: "cancelled" }), "Tournament is already cancelled.");
  assert.equal(tournamentCancellationError({ ...eligible, hasStarted: false }, true), null);
  assert.equal(tournamentCancellationError({ ...eligible, filledSlots: 12 }, true), null);
  assert.equal(tournamentCancellationError({ ...eligible, hasWinner: true }, true), "A tournament with a declared winner cannot be cancelled.");
  assert.equal(tournamentCancellationError({ ...eligible, status: "cancelled" }, true), "Tournament is already cancelled.");
});

test("automatic underfilled cancellation is limited to Clash Squad and Lone Wolf", () => {
  assert.equal(isAutomaticTournamentCancellationMode("clash_squad", "clash"), true);
  assert.equal(isAutomaticTournamentCancellationMode("lone_wolf", "clash"), true);
  assert.equal(isAutomaticTournamentCancellationMode(null, "clash"), true);
  assert.equal(isAutomaticTournamentCancellationMode("battle_royale", "solo"), false);
  assert.equal(isAutomaticTournamentCancellationMode(null, "squad"), false);

  const eligible = {
    gameMode: "lone_wolf",
    storageMode: "clash",
    status: "open",
    hasStarted: true,
    hasWinner: false,
    filledSlots: 1,
    capacity: 2,
  };
  assert.equal(shouldAutomaticallyCancelTournament(eligible), true);
  assert.equal(shouldAutomaticallyCancelTournament({ ...eligible, filledSlots: 2 }), false);
  assert.equal(shouldAutomaticallyCancelTournament({ ...eligible, hasStarted: false }), false);
  assert.equal(shouldAutomaticallyCancelTournament({ ...eligible, gameMode: "battle_royale" }), false);
});