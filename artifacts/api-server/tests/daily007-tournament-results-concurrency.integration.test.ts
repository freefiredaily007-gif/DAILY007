import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import compatExtraRouter from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "tournament-results-concurrency-tests-only-secret-at-least-32-chars";
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

type ResultResponse = {
  status: number;
  body: Record<string, unknown>;
};

type PlayerFixture = {
  userId: string;
  registrationId: string;
  gameUid: string;
};

type TournamentFixture = {
  adminId: string;
  matchId: string;
  players: [PlayerFixture, PlayerFixture];
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(compatExtraRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Test server encountered an unexpected error." });
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

function authHeaders(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token, "The test admin must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function submitResult(
  origin: string,
  adminId: string,
  matchId: string,
  player: PlayerFixture,
  kills: number,
): Promise<ResultResponse> {
  const response = await fetch(`${origin}/admin/results`, {
    method: "POST",
    headers: authHeaders(adminId),
    body: JSON.stringify({
      tournamentId: matchId,
      registrationId: player.registrationId,
      rank: 1,
      kills,
      prizeCoins: 0,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(): Promise<TournamentFixture> {
  const fixture: TournamentFixture = {
    adminId: randomUUID(),
    matchId: randomUUID(),
    players: [
      { userId: randomUUID(), registrationId: randomUUID(), gameUid: `uid-${randomUUID()}` },
      { userId: randomUUID(), registrationId: randomUUID(), gameUid: `uid-${randomUUID()}` },
    ],
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Concurrency Test Admin', $2, 'test-salt', 'test-hash', 'admin', 0)`,
      [fixture.adminId, `admin-${fixture.adminId}@example.test`],
    );
    for (const [index, player] of fixture.players.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash, wallet_coins)
         VALUES ($1, $2, $3, 'test-salt', 'test-hash', 100)`,
        [player.userId, `Test Player ${index + 1}`, `player-${player.userId}@example.test`],
      );
    }
    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, team_type, capacity, prize_pool, prize_distribution, starts_at)
       VALUES ($1, 'Isolated result race', 'solo', 'battle_royale', 'solo', 48,
               500, '1st: 500 coins', now() - interval '1 hour')`,
      [fixture.matchId],
    );
    for (const [index, player] of fixture.players.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name,
            captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, $6, '', 0, 'approved')`,
        [
          player.registrationId,
          fixture.matchId,
          player.userId,
          `Test Player ${index + 1}`,
          `TestGame${index + 1}`,
          player.gameUid,
        ],
      );
    }
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(fixture: TournamentFixture): Promise<void> {
  const client = await pool.connect();
  const playerIds = fixture.players.map((player) => player.userId);
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await client.query("DELETE FROM daily007_v2_result_awards WHERE match_id = $1", [fixture.matchId]);
    await client.query("DELETE FROM daily007_v2_registrations WHERE match_id = $1", [fixture.matchId]);
    await client.query("DELETE FROM daily007_v2_matches WHERE id = $1", [fixture.matchId]);
    await client.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.adminId, ...playerIds]],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function backendPid(client: { query<T>(sql: string): Promise<{ rows: T[] }> }): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the lock holder.");
  return Number(pid);
}

async function waitForBlockedResultRequests(
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<Array<{ pid: number; blockers: number[] }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query LIKE $1
        ORDER BY activity.query_start`,
      ["%FOR UPDATE OF r, m%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, "Only the two competing result requests should be blocked.");
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.includes(blockerPid)),
        "At least one request must be waiting directly on the test's tournament-row lock.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => pid === blockerPid || requestPids.has(pid)),
        ),
        "Every blocked request must be waiting behind the test lock or another queued result request.",
      );
      return result.rows.map((row) => ({
        pid: Number(row.pid),
        blockers: row.blockers.map(Number),
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} result requests to block in PostgreSQL.`);
}

test("concurrent first-place submissions serialize on the real tournament row lock", async () => {
  const fixture = await createFixture();
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[0], 4),
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[1], 9),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

      const winningIndex = results.findIndex((result) => result.status === 201);
      const losingIndex = results.findIndex((result) => result.status === 409);
      assert.notEqual(winningIndex, -1);
      assert.notEqual(losingIndex, -1);
      assert.equal(
        results[losingIndex].body.error,
        "A winner has already been declared for this tournament.",
      );

      const winningPlayer = fixture.players[winningIndex];
      const winningResult = results[winningIndex];
      assert.equal(winningResult.body.registrationId, winningPlayer.registrationId);
      assert.equal(winningResult.body.userId, winningPlayer.userId);
      assert.equal(winningResult.body.prizeCoins, 500);
      assert.equal(winningResult.body.walletCoins, 600);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE match_id = $1`,
        [fixture.matchId],
      );
      assert.deepEqual(awards.rows, [{
        registration_id: winningPlayer.registrationId,
        user_id: winningPlayer.userId,
        rank: 1,
        kills: winningIndex === 0 ? 4 : 9,
        prize_coins: 500,
      }], "exactly one first-place award must be stored");

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [fixture.players.map((player) => player.userId)],
      );
      const expectedWallets = fixture.players.map((player, index) => ({
        id: player.userId,
        wallet_coins: index === winningIndex ? 600 : 100,
      })).sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(wallets.rows, expectedWallets, "only the winning player's wallet should receive the prize");

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [fixture.players.map((player) => player.userId)],
      );
      assert.deepEqual(ledger.rows, [{
        user_id: winningPlayer.userId,
        amount: 500,
        balance_after: 600,
        reason: "match_prize",
      }], "only one prize ledger entry should be written");

      const stats = await pool.query<{
        user_id: string;
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT user_id, matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = ANY($1::uuid[])`,
        [fixture.players.map((player) => player.userId)],
      );
      assert.deepEqual(stats.rows, [{
        user_id: winningPlayer.userId,
        matches: 1,
        wins: 1,
        kills: winningIndex === 0 ? 4 : 9,
        prize_coins: 500,
      }], "only the winning player should receive result statistics");

      const match = await pool.query<{ enabled: boolean }>(
        "SELECT enabled FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: false }]);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});