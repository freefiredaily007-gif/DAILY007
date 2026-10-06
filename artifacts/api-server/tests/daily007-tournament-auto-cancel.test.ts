import assert from "node:assert/strict";
import test from "node:test";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";
import { autoCancellationTestDb } from "./support/daily007-auto-cancel-test-db";

const scheduledStartUtc = Date.parse("2035-04-05T14:30:00.000Z");
const scheduledStartWallTime = Date.parse("2035-04-05T20:00:00.000Z");

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
      `starvation-match-${String(index).padStart(3, "0")}`,
      "clash_squad",
      "clash",
      3,
    );
    tournament.startsAtWallMs = matchStart;
    return tournament;
  });
  const validMatch = match("starvation-match-100", "lone_wolf", "clash", 2);
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

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.matches.get(validMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.accounts.get("payer-valid")?.wallet_coins, 83);
  assert.equal(autoCancellationTestDb.ledger.size, 1);
  assert.equal(
    [...autoCancellationTestDb.ledger.values()].filter(({ matchId }) => matchId === validMatch.id).length,
    1,
  );

  await runDaily007AutoCancellationSweep();

  assert.equal(autoCancellationTestDb.ledger.size, 1);
  assert.equal(autoCancellationTestDb.accounts.get("payer-valid")?.wallet_coins, 83);
  assert.equal(autoCancellationTestDb.matches.get(validMatch.id)?.status, "cancelled");
  assert.equal(autoCancellationTestDb.mutationTrace.length, failingMatchCount * 4 + 2);
});
