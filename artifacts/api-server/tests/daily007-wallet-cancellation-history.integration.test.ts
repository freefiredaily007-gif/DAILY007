import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import { cancelUnderfilledTournamentAndRefund } from "../src/lib/daily007-tournament-cancellation";
import router from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "wallet-history-postgres-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;
if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

const fixture = {
  playerId: randomUUID(),
  otherPlayerId: randomUUID(),
  unauthenticatedPlayerId: randomUUID(),
  adjustedPlayerId: randomUUID(),
  knownTournamentId: randomUUID(),
  missingTournamentId: randomUUID(),
  structuredTournamentId: randomUUID(),
  structuredMissingTournamentId: randomUUID(),
  prizeMatchId: randomUUID(),
  prizeRegistrationId: randomUUID(),
  adjustedTournamentId: randomUUID(),
  adjustedRegistrationId: randomUUID(),
  malformedTournamentId: "not-a-valid-uuid",
};

after(async () => {
  try {
    await pool.query(
      "DELETE FROM daily007_v2_result_awards WHERE registration_id = $1",
      [fixture.prizeRegistrationId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id IN ($1, $2)",
      [fixture.playerId, fixture.otherPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.unauthenticatedPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.adjustedPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_registrations WHERE id = $1",
      [fixture.prizeRegistrationId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_registrations WHERE id = $1",
      [fixture.adjustedRegistrationId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [[
        fixture.knownTournamentId,
        fixture.structuredTournamentId,
        fixture.prizeMatchId,
        fixture.adjustedTournamentId,
      ]],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id IN ($1, $2)",
      [fixture.playerId, fixture.otherPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = $1",
      [fixture.unauthenticatedPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = $1",
      [fixture.adjustedPlayerId],
    );
  } finally {
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
    await pool.end();
  }
});

async function seedLegacyRefunds(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Wallet history test player', $2, 'test-salt', 'test-hash', 142)`,
      [fixture.playerId, `wallet-history-${fixture.playerId}@example.test`],
    );
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Other wallet history test player', $2, 'test-salt', 'test-hash', 83)`,
      [fixture.otherPlayerId, `wallet-history-${fixture.otherPlayerId}@example.test`],
    );
    await client.query(
      `INSERT INTO daily007_v2_matches (id, title)
       VALUES ($1, $2), ($3, $4)`,
      [
        fixture.knownTournamentId,
        "Legacy Clash Cup",
        fixture.structuredTournamentId,
        "Structured Reference Cup",
      ],
    );
    await client.query(
      `INSERT INTO daily007_v2_matches (id, title)
       VALUES ($1, 'Victory Royale Cup')`,
      [fixture.prizeMatchId],
    );
    await client.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_uid,
          entry_coins_paid, status)
       VALUES ($1, $2, $3, 'Wallet history test player', 'wallet-prize-uid', 0, 'approved')`,
      [fixture.prizeRegistrationId, fixture.prizeMatchId, fixture.playerId],
    );
    await client.query(
      `INSERT INTO daily007_v2_result_awards
         (match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, 2, 7, 100)`,
      [fixture.prizeMatchId, fixture.prizeRegistrationId, fixture.playerId],
    );
    await client.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id, details, created_at)
       VALUES
         ($1, 100, 142, 'match_prize', $12, $13, NULL, now() + interval '1 second'),
         ($1, 27, 142, 'tournament_cancel_refund', NULL, NULL, $2::jsonb, now()),
         ($1, 19, 115, 'tournament_cancel_refund', NULL, NULL, $3::jsonb, now() - interval '1 second'),
         ($1, 11, 96, 'tournament_cancel_refund', NULL, NULL, $4::jsonb, now() - interval '2 seconds'),
         ($1, 7, 85, 'tournament_cancel_refund', NULL, NULL, $5::jsonb, now() - interval '3 seconds'),
         ($1, 5, 78, 'tournament_cancel_refund', NULL, NULL, $6::jsonb, now() - interval '4 seconds'),
         ($1, 3, 73, 'tournament_cancel_refund', NULL, NULL, $7::jsonb, now() - interval '5 seconds'),
         ($1, 2, 70, 'tournament_cancel_refund', NULL, NULL, $8::jsonb, now() - interval '6 seconds'),
         ($1, 12, 82, 'payment_approved', NULL, NULL, NULL, now() - interval '7 seconds'),
         ($1, 9, 79, 'tournament_cancel_refund', $9, NULL, NULL, now() - interval '8 seconds'),
         ($1, 8, 71, 'tournament_cancel_refund', NULL, NULL, $10::jsonb, now() - interval '9 seconds'),
         ($1, 6, 65, 'tournament_cancel_refund', NULL, NULL, $11::jsonb, now() - interval '10 seconds')`,
      [
        fixture.playerId,
        JSON.stringify({ description: `Tournament cancellation refund — ${fixture.knownTournamentId}` }),
        JSON.stringify({ description: `Tournament cancellation refund — ${fixture.missingTournamentId}` }),
        JSON.stringify({ description: "Legacy cancellation refund — tournament ID unavailable" }),
        JSON.stringify({
          tournamentId: fixture.malformedTournamentId,
          description: "Refund for the cancelled weekend cup",
        }),
        JSON.stringify({}),
        JSON.stringify({ description: "   " }),
        JSON.stringify({ description: 17 }),
        fixture.knownTournamentId,
        JSON.stringify({ tournamentId: fixture.structuredTournamentId }),
        JSON.stringify({ tournamentId: fixture.structuredMissingTournamentId }),
        fixture.prizeMatchId,
        fixture.prizeRegistrationId,
      ],
    );
    await client.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, details, created_at)
        VALUES
          ($1, 83, 83, 'tournament_cancel_refund', NULL, $2::jsonb, now()),
          ($1, -9, 74, 'withdrawal_reserved', NULL, $3::jsonb, now() - interval '1 second')`,
      [
        fixture.otherPlayerId,
        JSON.stringify({ description: `Tournament cancellation refund — ${fixture.knownTournamentId}` }),
        JSON.stringify({ description: "Private other-player withdrawal" }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  });

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

test("Wallet history rejects missing and invalid sessions without returning seeded ledger entries", async () => {
  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Unauthenticated Wallet history player', $2, 'test-salt', 'test-hash', 42)`,
      [fixture.unauthenticatedPlayerId, `wallet-history-unauth-${fixture.unauthenticatedPlayerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, details)
       VALUES ($1, 42, 42, 'test_credit', $2::jsonb)`,
      [
        fixture.unauthenticatedPlayerId,
        JSON.stringify({ description: "Private seeded Wallet history entry" }),
      ],
    );

    const seededEntries = await pool.query(
      "SELECT id FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.unauthenticatedPlayerId],
    );
    assert.equal(seededEntries.rows.length, 1, "the isolated database must contain a ledger row to protect");

    await withServer(async (origin) => {
      for (const request of [
        { label: "missing session", headers: undefined },
        { label: "invalid session", headers: { authorization: "Bearer invalid-wallet-history-token" } },
      ]) {
        const response = await fetch(`${origin}/wallet/transactions`, {
          headers: request.headers,
        });
        const body: unknown = await response.json();

        assert.equal(response.status, 401, `${request.label} must be rejected`);
        assert.equal(
          Array.isArray(body),
          false,
          `${request.label} must not receive a Wallet ledger entry array`,
        );
        assert.equal(
          JSON.stringify(body).includes("Private seeded Wallet history entry"),
          false,
          `${request.label} must not receive the seeded ledger entry`,
        );
      }
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.unauthenticatedPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = $1",
      [fixture.unauthenticatedPlayerId],
    );
  }
});

test("Wallet history keeps a manual credit separate from an actual cancellation refund", async () => {
  const description = "Admin wallet adjustment — entry fee correction";
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, wallet_coins)
     VALUES ($1, 'Adjusted Wallet history player', $2, 'test-salt', 'test-hash', 112)`,
    [fixture.adjustedPlayerId, `wallet-history-adjusted-${fixture.adjustedPlayerId}@example.test`],
  );
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, mode, game_mode, capacity, starts_at, status)
     VALUES ($1, 'Entry Fee Correction Cup', 'clash', 'clash_squad', 2,
             now() - interval '2 hours', 'open')`,
    [fixture.adjustedTournamentId],
  );
  await pool.query(
    `INSERT INTO daily007_v2_registrations
       (id, match_id, captain_user_id, captain_name, captain_game_uid,
        entry_coins_paid, status)
     VALUES ($1, $2, $3, 'Adjusted Wallet history player', 'adjusted-wallet-uid', 25, 'approved')`,
    [fixture.adjustedRegistrationId, fixture.adjustedTournamentId, fixture.adjustedPlayerId],
  );
  await pool.query(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, match_id, registration_id,
        details, created_at)
     VALUES ($1, 12, 112, 'admin_credit:entry fee correction', $2, $3, $4::jsonb,
             now() - interval '1 second')`,
    [
      fixture.adjustedPlayerId,
      fixture.adjustedTournamentId,
      fixture.adjustedRegistrationId,
      JSON.stringify({ description }),
    ],
  );

  try {
    const cancellation = await cancelUnderfilledTournamentAndRefund(fixture.adjustedTournamentId);
    assert.deepEqual(cancellation, {
      id: fixture.adjustedTournamentId,
      status: "cancelled",
      registrationsRefunded: 1,
      accountsRefunded: 1,
      coinsRefunded: 25,
    });

    await withServer(async (origin) => {
      const token = makeToken(fixture.adjustedPlayerId, 0);
      assert.ok(token, "the isolated test player should receive a Daily007 session token");
      const response = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json() as Array<{
        amount: number;
        balanceAfter: number;
        reason: string;
        description: string;
        details?: { tournamentId?: string; tournamentTitle?: string };
      }>;

      assert.equal(response.status, 200);
      assert.deepEqual(
        body.map(({ amount, balanceAfter, reason, description: entryDescription, details }) => ({
          amount,
          balanceAfter,
          reason,
          description: entryDescription,
          tournamentId: details?.tournamentId,
          tournamentTitle: details?.tournamentTitle,
        })),
        [
          {
            amount: 25,
            balanceAfter: 137,
            reason: "tournament_cancel_refund",
            description: "Entry fee refunded — Entry Fee Correction Cup (tournament cancelled)",
            tournamentId: fixture.adjustedTournamentId,
            tournamentTitle: "Entry Fee Correction Cup",
          },
          {
            amount: 12,
            balanceAfter: 112,
            reason: "admin_credit:entry fee correction",
            description,
            tournamentId: undefined,
            tournamentTitle: undefined,
          },
        ],
        "Wallet history must retain the manual adjustment and tournament refund as distinct, correctly described entries",
      );
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.adjustedPlayerId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_registrations WHERE id = $1",
      [fixture.adjustedRegistrationId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_matches WHERE id = $1",
      [fixture.adjustedTournamentId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = $1",
      [fixture.adjustedPlayerId],
    );
  }
});

test("Wallet history keeps refunds readable and excludes another player's non-refund ledger entries", async () => {
  await seedLegacyRefunds();

  await withServer(async (origin) => {
    const token = makeToken(fixture.playerId, 0);
    assert.ok(token, "the isolated test player should receive a Daily007 session token");
    const response = await fetch(`${origin}/wallet/transactions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json() as Array<{
      amount: number;
      reason: string;
      description: string;
      registrationId?: string;
      tournamentTitle?: string;
      placementRank?: number;
      placementKills?: number;
    }>;

    assert.equal(response.status, 200);
    const prize = body.find(({ reason }) => reason === "match_prize");
    assert.deepEqual(
      prize && {
        description: prize.description,
        registrationId: prize.registrationId,
        tournamentTitle: prize.tournamentTitle,
        placementRank: prize.placementRank,
        placementKills: prize.placementKills,
      },
      {
        description: "Tournament prize — Victory Royale Cup · 2nd place · 7 kills",
        registrationId: fixture.prizeRegistrationId,
        tournamentTitle: "Victory Royale Cup",
        placementRank: 2,
        placementKills: 7,
      },
      "a prize credit should resolve its title and saved result using both ledger references",
    );
    assert.deepEqual(
      body.map(({ amount, reason, description }) => ({ amount, reason, description })),
      [
        {
          amount: 100,
          reason: "match_prize",
          description: "Tournament prize — Victory Royale Cup · 2nd place · 7 kills",
        },
        {
          amount: 27,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded — Legacy Clash Cup (tournament cancelled)",
        },
        {
          amount: 19,
          reason: "tournament_cancel_refund",
          description: `Entry fee refunded — tournament ${fixture.missingTournamentId} (tournament cancelled)`,
        },
        {
          amount: 11,
          reason: "tournament_cancel_refund",
          description: "Legacy cancellation refund — tournament ID unavailable",
        },
        {
          amount: 7,
          reason: "tournament_cancel_refund",
          description: "Refund for the cancelled weekend cup",
        },
        {
          amount: 5,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded (tournament cancelled)",
        },
        {
          amount: 3,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded (tournament cancelled)",
        },
        {
          amount: 2,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded (tournament cancelled)",
        },
        {
          amount: 12,
          reason: "payment_approved",
          description: "payment approved",
        },
        {
          amount: 9,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded — Legacy Clash Cup (tournament cancelled)",
        },
        {
          amount: 8,
          reason: "tournament_cancel_refund",
          description: "Entry fee refunded — Structured Reference Cup (tournament cancelled)",
        },
        {
          amount: 6,
          reason: "tournament_cancel_refund",
          description: `Entry fee refunded — tournament ${fixture.structuredMissingTournamentId} (tournament cancelled)`,
        },
      ],
    );
    assert.equal(
      body.some(({ amount, reason, description }) =>
        amount === -9 ||
        reason === "withdrawal_reserved" ||
        description === "Private other-player withdrawal"),
      false,
      "another player's withdrawal ledger entry must not appear in this Wallet history",
    );
  });
});
