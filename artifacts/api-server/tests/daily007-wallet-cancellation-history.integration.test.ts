import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
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
  knownTournamentId: randomUUID(),
  missingTournamentId: randomUUID(),
  structuredTournamentId: randomUUID(),
  structuredMissingTournamentId: randomUUID(),
  prizeMatchId: randomUUID(),
  prizeRegistrationId: randomUUID(),
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
      "DELETE FROM daily007_v2_registrations WHERE id = $1",
      [fixture.prizeRegistrationId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [[fixture.knownTournamentId, fixture.structuredTournamentId, fixture.prizeMatchId]],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id IN ($1, $2)",
      [fixture.playerId, fixture.otherPlayerId],
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
