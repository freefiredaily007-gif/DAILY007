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