import assert from "node:assert/strict";
import test from "node:test";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";
import { autoCancellationTestDb } from "./support/daily007-auto-cancel-test-db";

const scheduledStartUtc = Date.parse("2035-04-05T14:30:00.000Z");
const scheduledStartWallTime = Date.parse("2035-04-05T20:00:00.000Z");

function testMatchUuid(group: string, index: number): string {
  return `${group}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function match(
  id: string,
  gameMode: string,
  storageMode: string,
  capacity: number,
) {
  return {
    id,
    title: `Test ${gameMode}`,
    mode: storageMode,
    game_mode: gameMode,
    status: "open",
    capacity,
    startsAtWallMs: scheduledStartWallTime,
    hasWinner: false,
    enabled: true,
    isFull: false,
    roomId: "test-room",
    roomPassword: "test-password",
    roomPublished: true,
  };
}

function registration(
  id: string,
  matchId: string,
  payerId: string,
  fee: number,
  status: string,
) {
  return {
    id,
    match_id: matchId,
    captain_user_id: payerId,
    entry_coins_paid: fee,
    status,
  };
}

test("scheduled sweep refunds underfilled Clash Squad and Lone Wolf once at the IST start", async () => {
  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc - 1,
    matches: [
      match("clash-match", "clash_squad", "clash", 2),
      match("lone-wolf-match", "lone_wolf", "clash", 2),
      match("full-clash-match", "clash_squad", "clash", 2),
      match("underfilled-br-match", "battle_royale", "solo", 2),
    ],
    registrations: [
      registration("clash-reg", "clash-match", "payer-clash", 35, "approved"),
      registration("rejected-reg", "clash-match", "payer-rejected", 999, "rejected"),
      registration("lone-wolf-reg", "lone-wolf-match", "payer-lone-wolf", 27, "pending"),
      registration("full-reg-1", "full-clash-match", "payer-full-1", 80, "approved"),
      registration("full-reg-2", "full-clash-match", "payer-full-2", 90, "approved"),
      registration("br-reg", "underfilled-br-match", "payer-br", 55, "approved"),
    ],
    accounts: [
      { id: "payer-clash", wallet_coins: 120 },
      { id: "payer-rejected", wallet_coins: 44 },
      { id: "payer-lone-wolf", wallet_coins: 80 },
      { id: "payer-full-1", wallet_coins: 200 },
      { id: "payer-full-2", wallet_coins: 300 },
      { id: "payer-br", wallet_coins: 500 },
    ],
  });

  await runDaily007AutoCancellationSweep();

  for (const id of ["clash-match", "lone-wolf-match", "full-clash-match", "underfilled-br-match"]) {
    assert.equal(autoCancellationTestDb.matches.get(id)?.status, "open", `${id} must remain open before its start`);
  }
  assert.equal(autoCancellationTestDb.accounts.get("payer-clash")?.wallet_coins, 120);
  assert.equal(autoCancellationTestDb.accounts.get("payer-lone-wolf")?.wallet_coins, 80);
  assert.equal(autoCancellationTestDb.ledger.size, 0);

  autoCancellationTestDb.setNow(scheduledStartUtc);
  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.matches.get("clash-match")?.status, "cancelled");
  assert.equal(autoCancellationTestDb.matches.get("lone-wolf-match")?.status, "cancelled");
  assert.equal(autoCancellationTestDb.matches.get("full-clash-match")?.status, "open");
  assert.equal(autoCancellationTestDb.matches.get("underfilled-br-match")?.status, "open");

  assert.equal(autoCancellationTestDb.accounts.get("payer-clash")?.wallet_coins, 155);
  assert.equal(autoCancellationTestDb.accounts.get("payer-lone-wolf")?.wallet_coins, 107);
  assert.equal(autoCancellationTestDb.accounts.get("payer-rejected")?.wallet_coins, 44);
  assert.equal(autoCancellationTestDb.accounts.get("payer-full-1")?.wallet_coins, 200);
  assert.equal(autoCancellationTestDb.accounts.get("payer-full-2")?.wallet_coins, 300);
  assert.equal(autoCancellationTestDb.accounts.get("payer-br")?.wallet_coins, 500);
  assert.equal(autoCancellationTestDb.ledger.size, 2);
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()]
      .map(({ userId, amount, balanceAfter, matchId, registrationId }) => ({
        userId, amount, balanceAfter, matchId, registrationId,
      }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      {
        userId: "payer-clash",
        amount: 35,
        balanceAfter: 155,
        matchId: "clash-match",
        registrationId: "clash-reg",
      },
      {
        userId: "payer-lone-wolf",
        amount: 27,
        balanceAfter: 107,
        matchId: "lone-wolf-match",
        registrationId: "lone-wolf-reg",
      },
    ],
  );

  const balancesAfterRefund = new Map(
    [...autoCancellationTestDb.accounts].map(([id, account]) => [id, account.wallet_coins]),
  );
  const ledgerCountAfterRefund = autoCancellationTestDb.ledger.size;

  // Model the API's immediate startup sweep after a restart, against the same persistent test database.
  await runDaily007AutoCancellationSweep();

  assert.deepEqual(
    new Map([...autoCancellationTestDb.accounts].map(([id, account]) => [id, account.wallet_coins])),
    balancesAfterRefund,
  );
  assert.equal(autoCancellationTestDb.ledger.size, ledgerCountAfterRefund);
});

test("a failed cursor save after a committed cancellation does not repeat its refund", async () => {
  const firstMatch = match("cursor-save-first-match", "clash_squad", "clash", 2);
  firstMatch.startsAtWallMs = scheduledStartWallTime - 2_000;
  const nextMatch = match("cursor-save-next-match", "lone_wolf", "clash", 2);
  nextMatch.startsAtWallMs = scheduledStartWallTime - 1_000;

  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc,
    matches: [firstMatch, nextMatch],
    registrations: [
      registration("cursor-save-first-reg", firstMatch.id, "cursor-save-first-payer", 35, "approved"),
      registration("cursor-save-next-reg", nextMatch.id, "cursor-save-next-payer", 18, "pending"),
    ],
    accounts: [
      { id: "cursor-save-first-payer", wallet_coins: 120 },
      { id: "cursor-save-next-payer", wallet_coins: 70 },
    ],
  });
  autoCancellationTestDb.failNextCursorSave();

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.matches.get(firstMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.matches.get(nextMatch.id)?.status, "open");
  assert.equal(autoCancellationTestDb.accounts.get("cursor-save-first-payer")?.wallet_coins, 155);
  assert.equal(autoCancellationTestDb.accounts.get("cursor-save-next-payer")?.wallet_coins, 70);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === firstMatch.id).length,
    1,
    "the first tournament's refund must commit before the injected progress-save failure",
  );
  assert.equal(autoCancellationTestDb.settings.__daily007AutoCancelCursor, undefined);
  assert.deepEqual(autoCancellationTestDb.candidateSelectionSizes, [2]);

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.matches.get(firstMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("cursor-save-first-payer")?.wallet_coins, 155);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === firstMatch.id).length,
    1,
    "retrying after the failed save must not credit the first payer or write its refund twice",
  );
  assert.equal(autoCancellationTestDb.matches.get(nextMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("cursor-save-next-payer")?.wallet_coins, 88);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === nextMatch.id).length,
    1,
  );
  assert.deepEqual(
    autoCancellationTestDb.settings.__daily007AutoCancelCursor,
    {
      id: nextMatch.id,
      startsAt: new Date(nextMatch.startsAtWallMs).toISOString(),
    },
  );
  assert.deepEqual(
    autoCancellationTestDb.candidateSelectionSizes,
    [2, 1],
    "the following sweep must skip the already-cancelled tournament and advance to the next eligible one",
  );
});

test("a later payer failure rolls back one tournament without stopping the sweep", async () => {
  const failingMatch = match("refund-failure-match", "clash_squad", "clash", 3);
  failingMatch.startsAtWallMs = scheduledStartWallTime - 1_000;
  const followingMatch = match("following-match", "lone_wolf", "clash", 2);

  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc,
    matches: [failingMatch, followingMatch],
    registrations: [
      registration("failure-first-reg", "refund-failure-match", "payer-a-first", 25, "approved"),
      registration("failure-later-reg", "refund-failure-match", "payer-z-missing", 40, "pending"),
      registration("following-reg", "following-match", "payer-following", 18, "approved"),
    ],
    accounts: [
      { id: "payer-a-first", wallet_coins: 120 },
      { id: "payer-following", wallet_coins: 70 },
    ],
  });

  const failingMatchBefore = structuredClone(autoCancellationTestDb.matches.get("refund-failure-match"));
  const firstPayerBalanceBefore = autoCancellationTestDb.accounts.get("payer-a-first")?.wallet_coins;
  const missingPayerBefore = autoCancellationTestDb.accounts.get("payer-z-missing");

  await runDaily007AutoCancellationSweep();

  assert.deepEqual(
    autoCancellationTestDb.mutationTrace,
    [
      "wallet:payer-a-first",
      "ledger:failure-first-reg",
      "wallet:payer-following",
      "ledger:following-reg",
    ],
    "the first refund was attempted before its later payer failed, and the next tournament still refunded",
  );
  assert.deepEqual(
    autoCancellationTestDb.matches.get("refund-failure-match"),
    failingMatchBefore,
    "the failed tournament status and room details must roll back",
  );
  assert.equal(autoCancellationTestDb.accounts.get("payer-a-first")?.wallet_coins, firstPayerBalanceBefore);
  assert.deepEqual(autoCancellationTestDb.accounts.get("payer-z-missing"), missingPayerBefore);
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === "refund-failure-match"),
    [],
    "the failed tournament must not retain any refund ledger entries",
  );

  assert.equal(autoCancellationTestDb.matches.get("following-match")?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("payer-following")?.wallet_coins, 88);
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()].map(({ userId, amount, balanceAfter, matchId, registrationId }) => ({
      userId, amount, balanceAfter, matchId, registrationId,
    })),
    [{
      userId: "payer-following",
      amount: 18,
      balanceAfter: 88,
      matchId: "following-match",
      registrationId: "following-reg",
    }],
  );
});

test("a late finalization failure rolls back refunds and does not stop the sweep", async () => {
  const failingMatch = match("late-failure-match", "clash_squad", "clash", 3);
  failingMatch.startsAtWallMs = scheduledStartWallTime - 2_000;
  const followingMatch = match("following-after-finalize", "lone_wolf", "clash", 2);
  followingMatch.startsAtWallMs = scheduledStartWallTime - 1_000;

  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc,
    matches: [failingMatch, followingMatch],
    registrations: [
      registration("late-first-reg", "late-failure-match", "payer-late-a", 25, "approved"),
      registration("late-second-reg", "late-failure-match", "payer-late-b", 40, "pending"),
      registration("following-after-finalize-reg", "following-after-finalize", "payer-following", 18, "approved"),
    ],
    accounts: [
      { id: "payer-late-a", wallet_coins: 120 },
      { id: "payer-late-b", wallet_coins: 80 },
      { id: "payer-following", wallet_coins: 70 },
    ],
  });
  autoCancellationTestDb.failNextMatchFinalization("late-failure-match");

  const failingMatchBefore = structuredClone(autoCancellationTestDb.matches.get("late-failure-match"));
  const failingBalancesBefore = new Map(
    ["payer-late-a", "payer-late-b"].map((id) => [
      id,
      autoCancellationTestDb.accounts.get(id)?.wallet_coins,
    ]),
  );
  const failingLedgerBefore = new Map(
    [...autoCancellationTestDb.ledger]
      .filter(([, entry]) => entry.matchId === "late-failure-match")
      .map(([key, entry]) => [key, structuredClone(entry)]),
  );

  await runDaily007AutoCancellationSweep();

  assert.deepEqual(
    autoCancellationTestDb.mutationTrace,
    [
      "wallet:payer-late-a",
      "ledger:late-first-reg",
      "wallet:payer-late-b",
      "ledger:late-second-reg",
      "finalize:late-failure-match",
      "wallet:payer-following",
      "ledger:following-after-finalize-reg",
    ],
    "the final status update must fail after both refunds, and the following tournament must still refund",
  );
  assert.deepEqual(
    autoCancellationTestDb.matches.get("late-failure-match"),
    failingMatchBefore,
    "the failed tournament status and room details must return to their pre-sweep state",
  );
  assert.deepEqual(
    new Map(
      ["payer-late-a", "payer-late-b"].map((id) => [
        id,
        autoCancellationTestDb.accounts.get(id)?.wallet_coins,
      ]),
    ),
    failingBalancesBefore,
    "both payer balances must return to their pre-sweep state",
  );
  assert.deepEqual(
    new Map(
      [...autoCancellationTestDb.ledger]
        .filter(([, entry]) => entry.matchId === "late-failure-match")
        .map(([key, entry]) => [key, entry]),
    ),
    failingLedgerBefore,
    "refund ledger entries for the failed tournament must return to their pre-sweep state",
  );

  assert.equal(autoCancellationTestDb.matches.get("following-after-finalize")?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("payer-following")?.wallet_coins, 88);
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === "following-after-finalize"),
    [{
      userId: "payer-following",
      amount: 18,
      balanceAfter: 88,
      reason: "tournament_cancel_refund",
      matchId: "following-after-finalize",
      registrationId: "following-after-finalize-reg",
      details: {
        description: "Entry fee refunded — Test lone_wolf (tournament cancelled)",
        tournamentId: "following-after-finalize",
        tournamentTitle: "Test lone_wolf",
      },
      createdAt: new Date(scheduledStartUtc),
    }],
  );
});

test("a failing batch does not starve later tournament refunds across sweeps", async () => {
  const failingMatchCount = 100;
  const matchStart = scheduledStartWallTime - 1_000;
  const matches = Array.from({ length: failingMatchCount }, (_, index) => {
    const tournament = match(
      testMatchUuid("30000000", index + 1),
      "clash_squad",
      "clash",
      3,
    );
    tournament.startsAtWallMs = matchStart;
    return tournament;
  });
  const validMatch = match(testMatchUuid("30000000", 101), "lone_wolf", "clash", 2);
  validMatch.startsAtWallMs = matchStart;

  const registrations = matches.flatMap((tournament, index) => [
    registration(`starvation-first-${index}`, tournament.id, `payer-${index}-a`, 7, "approved"),
    registration(`starvation-failure-${index}`, tournament.id, `payer-${index}-z`, 11, "pending"),
  ]);
  registrations.push(registration("starvation-valid-reg", validMatch.id, "payer-valid", 13, "approved"));
  const accounts = matches.map((_, index) => ({ id: `payer-${index}-a`, wallet_coins: 50 }));
  accounts.push({ id: "payer-valid", wallet_coins: 70 });

  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc,
    matches: [...matches, validMatch],
    registrations,
    accounts,
  });

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.mutationTrace.length, failingMatchCount * 2);
  for (let index = 0; index < failingMatchCount; index += 1) {
    const failedMatch = matches[index]!;
    assert.equal(autoCancellationTestDb.matches.get(failedMatch.id)?.status, "open");
    assert.equal(autoCancellationTestDb.accounts.get(`payer-${index}-a`)?.wallet_coins, 50);
  }
  assert.equal(autoCancellationTestDb.ledger.size, 0);
  assert.equal(autoCancellationTestDb.matches.get(validMatch.id)?.status, "open");
  assert.equal(autoCancellationTestDb.accounts.get("payer-valid")?.wallet_coins, 70);
  assert.deepEqual(
    autoCancellationTestDb.candidateSelectionSizes,
    [100],
    "the first sweep must process only its 100-candidate batch",
  );
  assert.deepEqual(
    autoCancellationTestDb.settings.__daily007AutoCancelCursor,
    {
      id: matches[matches.length - 1]!.id,
      startsAt: new Date(matchStart).toISOString(),
    },
    "the position after the failing batch must be stored outside the API process",
  );

  // A fresh invocation reads its position from the persistent settings row, as a restarted process will.
  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.matches.get(validMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("payer-valid")?.wallet_coins, 83);
  assert.equal(autoCancellationTestDb.ledger.size, 1);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === validMatch.id).length,
    1,
  );
  assert.deepEqual(
    autoCancellationTestDb.candidateSelectionSizes,
    [100, 1],
    "the restarted sweep must begin after the persisted cursor and process only the later tournament",
  );

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.ledger.size, 1);
  assert.equal(autoCancellationTestDb.accounts.get("payer-valid")?.wallet_coins, 83);
  assert.equal(autoCancellationTestDb.matches.get(validMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.mutationTrace.length, failingMatchCount * 4 + 2);
  assert.deepEqual(
    autoCancellationTestDb.candidateSelectionSizes,
    [100, 1, 0, 100],
    "the cursor wraps only after reaching the end and no sweep exceeds 100 candidates",
  );
});

test("a cursor wrap reaches a tournament that becomes underfilled behind it", async () => {
  const earlierMatch = match(testMatchUuid("40000000", 1), "clash_squad", "clash", 2);
  earlierMatch.startsAtWallMs = scheduledStartWallTime - 2_000;
  const laterMatch = match(testMatchUuid("40000000", 2), "lone_wolf", "clash", 3);
  laterMatch.startsAtWallMs = scheduledStartWallTime - 1_000;

  autoCancellationTestDb.reset({
    nowMs: scheduledStartUtc,
    matches: [earlierMatch, laterMatch],
    registrations: [
      registration("cursor-earlier-refund", earlierMatch.id, "payer-earlier", 17, "approved"),
      registration("cursor-earlier-filler", earlierMatch.id, "payer-filler", 19, "approved"),
      registration("cursor-later-first", laterMatch.id, "payer-a-later", 11, "approved"),
      registration("cursor-later-failure", laterMatch.id, "payer-z-missing", 13, "pending"),
    ],
    accounts: [
      { id: "payer-earlier", wallet_coins: 40 },
      { id: "payer-a-later", wallet_coins: 50 },
    ],
  });

  await runDaily007AutoCancellationSweep();

  assert.deepEqual(autoCancellationTestDb.candidateSelectionSizes, [1]);
  assert.equal(autoCancellationTestDb.matches.get(earlierMatch.id)?.status, "open");
  assert.equal(autoCancellationTestDb.matches.get(laterMatch.id)?.status, "open");
  assert.deepEqual(
    autoCancellationTestDb.settings.__daily007AutoCancelCursor,
    {
      id: laterMatch.id,
      startsAt: new Date(laterMatch.startsAtWallMs).toISOString(),
    },
    "the cursor must advance past the earlier, still-full tournament",
  );
  assert.equal(autoCancellationTestDb.accounts.get("payer-a-later")?.wallet_coins, 50);
  assert.equal(autoCancellationTestDb.ledger.size, 0);

  const fillerRegistration = autoCancellationTestDb.registrations.find(
    ({ id }) => id === "cursor-earlier-filler",
  );
  assert.ok(fillerRegistration);
  fillerRegistration.status = "rejected";

  await runDaily007AutoCancellationSweep();

  assert.deepEqual(
    autoCancellationTestDb.candidateSelectionSizes,
    [1, 0, 2],
    "after exhausting the cursor, the wrapped batch must include the newly eligible earlier tournament and the still-eligible later one",
  );
  assert.ok(autoCancellationTestDb.candidateSelectionSizes.every((size) => size <= 100));
  assert.equal(autoCancellationTestDb.matches.get(earlierMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("payer-earlier")?.wallet_coins, 57);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === earlierMatch.id).length,
    1,
    "the earlier tournament must be refunded exactly once",
  );
  assert.equal(autoCancellationTestDb.matches.get(laterMatch.id)?.status, "open");
  assert.equal(autoCancellationTestDb.accounts.get("payer-a-later")?.wallet_coins, 50);
  assert.deepEqual(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === laterMatch.id),
    [],
    "the later tournament's partial refund attempt must still roll back",
  );

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.accounts.get("payer-earlier")?.wallet_coins, 57);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === earlierMatch.id).length,
    1,
  );
  assert.deepEqual(autoCancellationTestDb.candidateSelectionSizes, [1, 0, 2, 0, 1]);
});

test("malformed saved cursor metadata restarts refunds in capped batches", async (t) => {
  const candidateCount = 101;
  const matchStart = scheduledStartWallTime - 1_000;

  const assertRecovery = async (
    scenario: string,
    uuidGroup: string,
    malformedCursor: Record<string, unknown>,
  ) => {
    const matches = Array.from({ length: candidateCount }, (_, index) => {
      const candidate = match(
        testMatchUuid(uuidGroup, index + 1),
        "clash_squad",
        "clash",
        2,
      );
      candidate.startsAtWallMs = matchStart;
      return candidate;
    });
    const payerId = `${scenario}-payer`;

    autoCancellationTestDb.reset({
      nowMs: scheduledStartUtc,
      matches,
      registrations: [
        registration(`${scenario}-refund`, matches[0]!.id, payerId, 13, "approved"),
      ],
      accounts: [{ id: payerId, wallet_coins: 50 }],
      settings: { __daily007AutoCancelCursor: malformedCursor },
    });

    await runDaily007AutoCancellationSweep();

    assert.deepEqual(
      autoCancellationTestDb.candidateSelectionSizes,
      [100],
      `${scenario}: malformed progress must restart from the first candidate and process no more than 100`,
    );
    assert.deepEqual(
      autoCancellationTestDb.settings.__daily007AutoCancelCursor,
      {
        id: matches[99]!.id,
        startsAt: new Date(matchStart).toISOString(),
      },
      `${scenario}: processing must replace malformed progress with a valid cursor`,
    );
    assert.equal(autoCancellationTestDb.matches.get(matches[0]!.id)?.status, "cancelled");
    assert.equal(autoCancellationTestDb.matches.get(matches[99]!.id)?.status, "cancelled");
    assert.equal(autoCancellationTestDb.matches.get(matches[100]!.id)?.status, "open");
    assert.equal(autoCancellationTestDb.accounts.get(payerId)?.wallet_coins, 63);
    assert.equal(
      [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === matches[0]!.id).length,
      1,
    );

    await runDaily007AutoCancellationSweep();

    assert.deepEqual(
      autoCancellationTestDb.candidateSelectionSizes,
      [100, 1],
      `${scenario}: the repaired cursor must reach the candidate after the first capped batch`,
    );
    assert.deepEqual(
      autoCancellationTestDb.settings.__daily007AutoCancelCursor,
      {
        id: matches[100]!.id,
        startsAt: new Date(matchStart).toISOString(),
      },
    );
    assert.equal(autoCancellationTestDb.matches.get(matches[100]!.id)?.status, "cancelled");
    assert.equal(autoCancellationTestDb.accounts.get(payerId)?.wallet_coins, 63);
    assert.equal(autoCancellationTestDb.ledger.size, 1);

    await runDaily007AutoCancellationSweep();

    assert.deepEqual(autoCancellationTestDb.candidateSelectionSizes, [100, 1, 0, 0]);
    assert.ok(autoCancellationTestDb.candidateSelectionSizes.every((size) => size <= 100));
    assert.equal(autoCancellationTestDb.settings.__daily007AutoCancelCursor, null);
    assert.ok(
      matches.every(({ id }) => autoCancellationTestDb.matches.get(id)?.status === "cancelled"),
    );
    assert.equal(autoCancellationTestDb.accounts.get(payerId)?.wallet_coins, 63);
    assert.equal(autoCancellationTestDb.ledger.size, 1);
  };

  await t.test("invalid cursor ID", async () => {
    await assertRecovery("invalid-id", "50000000", {
      id: "not-a-uuid",
      startsAt: new Date(matchStart).toISOString(),
    });
  });

  await t.test("invalid cursor timestamp", async () => {
    await assertRecovery("invalid-timestamp", "60000000", {
      id: testMatchUuid("70000000", 1),
      startsAt: "not-a-timestamp",
    });
  });
});
