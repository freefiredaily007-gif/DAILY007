import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { makeToken } from "../src/lib/daily007-session-token";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";
import router from "../src/routes/daily007-compat-extra";
import { autoCancellationTestDb } from "./support/daily007-auto-cancel-test-db";

const TEST_PLAYER_ID = "10000000-0000-4000-8000-000000000001";
const TEST_AUTH_SECRET = "wallet-history-test-secret-value-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function walletHistory(origin: string): Promise<JsonResult> {
  const token = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}/wallet/transactions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

test("cancelled tournament refunds stay clear and singular in Wallet history after a repeated startup sweep", async () => {
  const nowMs = Date.now();
  const matchId = "wallet-history-cancel-match";
  const registrationId = "wallet-history-cancel-registration";
  const tournamentTitle = "Daily007 Clash Finals";
  const description = `Entry fee refunded — ${tournamentTitle} (tournament cancelled)`;

  autoCancellationTestDb.reset({
    nowMs,
    matches: [{
      id: matchId,
      title: tournamentTitle,
      mode: "clash",
      game_mode: "clash_squad",
      status: "open",
      capacity: 2,
      startsAtWallMs: nowMs - 1_000,
      hasWinner: false,
      enabled: true,
      isFull: false,
      roomId: "wallet-history-room",
      roomPassword: "wallet-history-password",
      roomPublished: true,
    }],
    registrations: [{
      id: registrationId,
      match_id: matchId,
      captain_user_id: TEST_PLAYER_ID,
      entry_coins_paid: 35,
      status: "approved",
    }],
    accounts: [{ id: TEST_PLAYER_ID, wallet_coins: 120 }],
  });

  await withServer(async (origin) => {
    await runDaily007AutoCancellationSweep();
    assert.equal(autoCancellationTestDb.matches.get(matchId)?.status, "cancelled");
    assert.equal(autoCancellationTestDb.accounts.get(TEST_PLAYER_ID)?.wallet_coins, 155);
    assert.equal(autoCancellationTestDb.ledger.size, 1);

    const firstHistory = await walletHistory(origin);
    assert.equal(firstHistory.status, 200);
    assert.equal(firstHistory.body.length, 1);
    assert.deepEqual(
      {
        amount: firstHistory.body[0].amount,
        balanceAfter: firstHistory.body[0].balanceAfter,
        reason: firstHistory.body[0].reason,
        description: firstHistory.body[0].description,
      },
      {
        amount: 35,
        balanceAfter: 155,
        reason: "tournament_cancel_refund",
        description,
      },
    );

    // Model the immediate sweep after an API restart and refresh Wallet from the route again.
    await runDaily007AutoCancellationSweep();
    const refreshedHistory = await walletHistory(origin);
    assert.equal(refreshedHistory.status, 200);
    assert.deepEqual(refreshedHistory.body, firstHistory.body);
    assert.equal(refreshedHistory.body.length, 1);
    assert.equal(autoCancellationTestDb.ledger.size, 1);
    assert.equal(autoCancellationTestDb.accounts.get(TEST_PLAYER_ID)?.wallet_coins, 155);
  });
});

test("older cancellation refunds resolve tournament names and retain an ID fallback", async () => {
  const nowMs = Date.parse("2035-04-05T14:30:00.000Z");
  const knownTournamentId = "00000000-0000-4000-8000-000000000081";
  const missingTournamentId = "00000000-0000-4000-8000-000000000082";
  const tournamentTitle = "Legacy Clash Cup";

  autoCancellationTestDb.reset({
    nowMs,
    matches: [{
      id: knownTournamentId,
      title: tournamentTitle,
      mode: "clash",
      game_mode: "clash_squad",
      status: "cancelled",
      capacity: 2,
      startsAtWallMs: nowMs - 60_000,
      hasWinner: false,
      enabled: false,
      isFull: false,
      roomId: null,
      roomPassword: null,
      roomPublished: false,
    }],
    registrations: [],
    accounts: [{ id: TEST_PLAYER_ID, wallet_coins: 142 }],
    ledger: [
      {
        idempotencyKey: "legacy-refund-with-tournament-record",
        entry: {
          userId: TEST_PLAYER_ID,
          amount: 27,
          balanceAfter: 142,
          reason: "tournament_cancel_refund",
          matchId: null,
          registrationId: "00000000-0000-4000-8000-000000000091",
          details: { description: `Tournament cancellation refund — ${knownTournamentId}` },
          createdAt: new Date(nowMs - 1_000),
        },
      },
      {
        idempotencyKey: "legacy-refund-without-tournament-record",
        entry: {
          userId: TEST_PLAYER_ID,
          amount: 19,
          balanceAfter: 115,
          reason: "tournament_cancel_refund",
          matchId: null,
          registrationId: "00000000-0000-4000-8000-000000000092",
          details: { description: `Tournament cancellation refund — ${missingTournamentId}` },
          createdAt: new Date(nowMs - 2_000),
        },
      },
    ],
  });

  await withServer(async (origin) => {
    const history = await walletHistory(origin);
    assert.equal(history.status, 200);
    assert.deepEqual(
      history.body.map(({ amount, reason, description }: {
        amount: number;
        reason: string;
        description: string;
      }) => ({ amount, reason, description })),
      [
        {
          amount: 27,
          reason: "tournament_cancel_refund",
          description: `Entry fee refunded — ${tournamentTitle} (tournament cancelled)`,
        },
        {
          amount: 19,
          reason: "tournament_cancel_refund",
          description: `Entry fee refunded — tournament ${missingTournamentId} (tournament cancelled)`,
        },
      ],
    );
  });
});