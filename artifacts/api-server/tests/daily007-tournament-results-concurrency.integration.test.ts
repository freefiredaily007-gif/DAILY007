import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import compatCoreRouter from "../src/routes/daily007-compat-core";
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
  players: [PlayerFixture, PlayerFixture, ...PlayerFixture[]];
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});


async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(compatCoreRouter);
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
  rank: number,
  kills: number,
): Promise<ResultResponse> {
  const response = await fetch(`${origin}/admin/results`, {
    method: "POST",
    headers: authHeaders(adminId),
    body: JSON.stringify({
      tournamentId: matchId,
      registrationId: player.registrationId,
      rank,
      kills,
      prizeCoins: 0,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(playerCount = 2): Promise<TournamentFixture> {
  if (!Number.isSafeInteger(playerCount) || playerCount < 2) {
    throw new Error("A tournament result fixture requires at least two players.");
  }
  const fixture: TournamentFixture = {
    adminId: randomUUID(),
    matchId: randomUUID(),
    players: Array.from({ length: playerCount }, () => ({
      userId: randomUUID(),
      registrationId: randomUUID(),
      gameUid: `uid-${randomUUID()}`,
    })) as TournamentFixture["players"],
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
                875, '1st: 500 coins\n2nd: 250 coins\n3rd: 125 coins', now() - interval '1 hour')`,
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

async function seedExistingPlayerHistory(player: PlayerFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const walletUpdate = await client.query(
      "UPDATE daily007_v2_users SET wallet_coins = 1000 WHERE id = $1",
      [player.userId],
    );
    assert.equal(walletUpdate.rowCount, 1, "the seeded history player must exist");
    await client.query(
      `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
       VALUES ($1, 5, 1, 42, 500)`,
      [player.userId],
    );
    await client.query(
      `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
       VALUES ($1, 500, 1000, 'match_prize')`,
      [player.userId],
    );
    await client.query("COMMIT");
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
  const registrationIds = fixture.players.map((player) => player.registrationId);
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
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE registration_id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE id = ANY($1::uuid[])",
      [registrationIds],
    );
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

async function captureSettlementState(fixture: TournamentFixture, player: PlayerFixture) {
  const [wallet, awards, stats, ledger, match] = await Promise.all([
    pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [player.userId],
    ),
    pool.query<{
      registration_id: string;
      user_id: string;
      rank: number;
      kills: number;
      prize_coins: number;
    }>(
      `SELECT registration_id, user_id, rank, kills, prize_coins
         FROM daily007_v2_result_awards
        WHERE match_id = $1
        ORDER BY rank`,
      [fixture.matchId],
    ),
    pool.query<{ matches: number; wins: number; kills: number; prize_coins: number }>(
      `SELECT matches, wins, kills, prize_coins
         FROM daily007_v2_user_stats
        WHERE user_id = $1`,
      [player.userId],
    ),
    pool.query<{ amount: number; balance_after: number; reason: string }>(
      `SELECT amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1
        ORDER BY id`,
      [player.userId],
    ),
    pool.query<{ enabled: boolean; status: string }>(
      "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchId],
    ),
  ]);

  return {
    walletCoins: wallet.rows[0]?.wallet_coins ?? null,
    awards: awards.rows,
    stats: stats.rows[0] ?? null,
    ledger: ledger.rows,
    match: match.rows[0] ?? null,
  };
}

async function publicStandings(origin: string, matchId: string) {
  const response = await fetch(`${origin}/tournaments/${matchId}/results`);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function installRunnerUpLedgerFailure(userId: string): Promise<void> {
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  await pool.query("CREATE SEQUENCE daily007_test_result_failure_observed_seq");
  await pool.query(`
    CREATE FUNCTION daily007_test_fail_runner_up_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      IF NEW.user_id::text = TG_ARGV[0] AND NEW.reason = 'match_prize' THEN
        PERFORM nextval('daily007_test_result_failure_observed_seq');
        RAISE EXCEPTION 'Injected failure at runner-up prize ledger insert'
          USING ERRCODE = 'XX000';
      END IF;
      RETURN NEW;
    END;
    $body$
  `);
  await pool.query(`
    CREATE TRIGGER daily007_test_fail_runner_up_ledger
    BEFORE INSERT ON daily007_v2_wallet_ledger
    FOR EACH ROW
    EXECUTE FUNCTION daily007_test_fail_runner_up_ledger('${userId}')
  `);
}

async function removeRunnerUpLedgerFailure(): Promise<void> {
  await pool.query(
    "DROP TRIGGER IF EXISTS daily007_test_fail_runner_up_ledger ON daily007_v2_wallet_ledger",
  );
  await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_runner_up_ledger()");
  await pool.query("DROP SEQUENCE IF EXISTS daily007_test_result_failure_observed_seq");
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
      assert.equal(
        result.rows.length,
        expectedCount,
        `Only the ${expectedCount} competing result requests should be blocked.`,
      );
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
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[0], 1, 4),
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[1], 1, 9),
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

test("concurrent retries for the same registration publish and pay exactly once", async () => {
  const fixture = await createFixture();
  const player = fixture.players[0];
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
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 4),
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 4),
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

      const successful = results.find((result) => result.status === 201);
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one result request must succeed");
      assert.ok(rejected, "the duplicate result request must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );
      assert.equal(successful.body.registrationId, player.registrationId);
      assert.equal(successful.body.userId, player.userId);
      assert.equal(successful.body.prizeCoins, 500);
      assert.equal(successful.body.walletCoins, 600);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE registration_id = $1`,
        [player.registrationId],
      );
      assert.deepEqual(awards.rows, [{
        registration_id: player.registrationId,
        user_id: player.userId,
        rank: 1,
        kills: 4,
        prize_coins: 500,
      }], "the registration must have exactly one award");

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [fixture.players.map((entry) => entry.userId)],
      );
      const expectedWallets = fixture.players.map((entry, index) => ({
        id: entry.userId,
        wallet_coins: index === 0 ? 600 : 100,
      })).sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(wallets.rows, expectedWallets, "the prize must be credited once");

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
        [fixture.players.map((entry) => entry.userId)],
      );
      assert.deepEqual(ledger.rows, [{
        user_id: player.userId,
        amount: 500,
        balance_after: 600,
        reason: "match_prize",
      }], "only one prize ledger entry must be written");

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
        [fixture.players.map((entry) => entry.userId)],
      );
      assert.deepEqual(stats.rows, [{
        user_id: player.userId,
        matches: 1,
        wins: 1,
        kills: 4,
        prize_coins: 500,
      }], "result statistics must be applied once");

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

test("concurrent runner-up retries for the same registration award and pay exactly once", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[1];
  const otherPlayer = fixture.players[0];
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
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 6),
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 9),
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

      const successful = results.find((result) => result.status === 201);
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one runner-up result request must succeed");
      assert.ok(rejected, "the concurrent runner-up retry must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );
      assert.equal(successful.body.registrationId, runnerUp.registrationId);
      assert.equal(successful.body.userId, runnerUp.userId);
      assert.equal(successful.body.prizeCoins, 250);
      assert.equal(successful.body.walletCoins, 350);
      const successfulKills = results[0].status === 201 ? 6 : 9;

      const runnerUpState = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(runnerUpState, {
        walletCoins: 350,
        awards: [{
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: successfulKills,
          prize_coins: 250,
        }],
        stats: {
          matches: 1,
          wins: 0,
          kills: successfulKills,
          prize_coins: 250,
        },
        ledger: [{
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        }],
        match: {
          enabled: true,
          status: "open",
        },
      });

      const otherPlayerState = await captureSettlementState(fixture, otherPlayer);
      assert.equal(otherPlayerState.walletCoins, 100);
      assert.equal(otherPlayerState.stats, null);
      assert.deepEqual(otherPlayerState.ledger, []);
      assert.equal(otherPlayerState.awards.length, 1);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("concurrent first- and second-place results cannot pay one registration twice", async () => {
  const fixture = await createFixture();
  const player = fixture.players[0];
  const otherPlayer = fixture.players[1];
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
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 8),
        submitResult(origin, fixture.adminId, fixture.matchId, player, 2, 3),
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

      const successfulIndex = results.findIndex((result) => result.status === 201);
      const successful = results[successfulIndex];
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one result rank must be accepted");
      assert.ok(rejected, "the other rank for the same registration must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );

      const successfulRank = successfulIndex === 0 ? 1 : 2;
      const successfulKills = successfulIndex === 0 ? 8 : 3;
      const successfulPrize = successfulRank === 1 ? 500 : 250;
      const successfulBalance = 100 + successfulPrize;
      assert.equal(successful.body.registrationId, player.registrationId);
      assert.equal(successful.body.userId, player.userId);
      assert.equal(successful.body.prizeCoins, successfulPrize);
      assert.equal(successful.body.walletCoins, successfulBalance);

      const playerState = await captureSettlementState(fixture, player);
      assert.deepEqual(playerState, {
        walletCoins: successfulBalance,
        awards: [{
          registration_id: player.registrationId,
          user_id: player.userId,
          rank: successfulRank,
          kills: successfulKills,
          prize_coins: successfulPrize,
        }],
        stats: {
          matches: 1,
          wins: successfulRank === 1 ? 1 : 0,
          kills: successfulKills,
          prize_coins: successfulPrize,
        },
        ledger: [{
          amount: successfulPrize,
          balance_after: successfulBalance,
          reason: "match_prize",
        }],
        match: {
          enabled: successfulRank !== 1,
          status: "open",
        },
      });

      const otherPlayerState = await captureSettlementState(fixture, otherPlayer);
      assert.equal(otherPlayerState.walletCoins, 100);
      assert.equal(otherPlayerState.stats, null);
      assert.deepEqual(otherPlayerState.ledger, []);
      assert.equal(otherPlayerState.awards.length, 1);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("concurrent first-, second-, and third-place results preserve configured prizes and standings", async () => {
  const fixture = await createFixture(3);
  const [winner, runnerUp, thirdPlace] = fixture.players;
  assert.ok(winner && runnerUp && thirdPlace, "three uniquely identified player fixtures are required");
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
        submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7),
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3),
        submitResult(origin, fixture.adminId, fixture.matchId, thirdPlace, 3, 5),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 3);
        assert.equal(waitingRequests.length, 3);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status), [201, 201, 201]);
      assert.deepEqual(results.map((result) => ({
        registrationId: result.body.registrationId,
        userId: result.body.userId,
        prizeCoins: result.body.prizeCoins,
        walletCoins: result.body.walletCoins,
      })), [
        {
          registrationId: winner.registrationId,
          userId: winner.userId,
          prizeCoins: 500,
          walletCoins: 600,
        },
        {
          registrationId: runnerUp.registrationId,
          userId: runnerUp.userId,
          prizeCoins: 250,
          walletCoins: 350,
        },
        {
          registrationId: thirdPlace.registrationId,
          userId: thirdPlace.userId,
          prizeCoins: 125,
          walletCoins: 225,
        },
      ]);

      const standings = await fetch(`${origin}/tournaments/${fixture.matchId}/results`);
      assert.equal(standings.status, 200);
      const standingsBody = await standings.json() as {
        tournamentId: string;
        status: string;
        finalizedAt: string | null;
        entries: Array<Record<string, unknown>>;
      };
      assert.equal(standingsBody.tournamentId, fixture.matchId);
      assert.equal(standingsBody.status, "finalized");
      assert.ok(standingsBody.finalizedAt);
      assert.match(standingsBody.finalizedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.deepEqual(standingsBody.entries, [
        {
          rank: 1,
          kills: 7,
          prizeCoins: 500,
          gameName: "TestGame1",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame2",
          teamName: null,
        },
        {
          rank: 3,
          kills: 5,
          prizeCoins: 125,
          gameName: "TestGame3",
          teamName: null,
        },
      ]);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE match_id = $1
          ORDER BY rank`,
        [fixture.matchId],
      );
      assert.deepEqual(awards.rows, [
        {
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 7,
          prize_coins: 500,
        },
        {
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: 3,
          prize_coins: 250,
        },
        {
          registration_id: thirdPlace.registrationId,
          user_id: thirdPlace.userId,
          rank: 3,
          kills: 5,
          prize_coins: 125,
        },
      ]);
      assert.equal(awards.rows.filter((award) => award.rank === 1).length, 1);

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(wallets.rows, [
        { id: winner.userId, wallet_coins: 600 },
        { id: runnerUp.userId, wallet_coins: 350 },
        { id: thirdPlace.userId, wallet_coins: 225 },
      ].sort((left, right) => left.id.localeCompare(right.id)));

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
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(ledger.rows, [
        {
          user_id: winner.userId,
          amount: 500,
          balance_after: 600,
          reason: "match_prize",
        },
        {
          user_id: runnerUp.userId,
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        },
        {
          user_id: thirdPlace.userId,
          amount: 125,
          balance_after: 225,
          reason: "match_prize",
        },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)));

      const stats = await pool.query<{
        user_id: string;
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT user_id, matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(stats.rows, [
        {
          user_id: winner.userId,
          matches: 1,
          wins: 1,
          kills: 7,
          prize_coins: 500,
        },
        {
          user_id: runnerUp.userId,
          matches: 1,
          wins: 0,
          kills: 3,
          prize_coins: 250,
        },
        {
          user_id: thirdPlace.userId,
          matches: 1,
          wins: 0,
          kills: 5,
          prize_coins: 125,
        },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)));

      const match = await pool.query<{ enabled: boolean; status: string }>(
        "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: false, status: "open" }]);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("failed runner-up payout preserves the earlier winner and permits one retry", async () => {
  const fixture = await createFixture();
  const [winner, runnerUp] = fixture.players;
  assert.ok(winner && runnerUp, "winner and runner-up fixtures are required");

  try {
    await seedExistingPlayerHistory(runnerUp);
    await withServer(async (origin) => {
      const winningResult = await submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7);
      assert.equal(
        winningResult.status,
        201,
        `the first-place payout must commit before the runner-up attempt: ${JSON.stringify(winningResult.body)}`,
      );
      assert.equal(winningResult.body.prizeCoins, 500);
      assert.equal(winningResult.body.walletCoins, 600);

      const winnerStateAfterFirst = await captureSettlementState(fixture, winner);
      assert.deepEqual(winnerStateAfterFirst, {
        walletCoins: 600,
        awards: [{
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 7,
          prize_coins: 500,
        }],
        stats: { matches: 1, wins: 1, kills: 7, prize_coins: 500 },
        ledger: [{ amount: 500, balance_after: 600, reason: "match_prize" }],
        match: { enabled: false, status: "open" },
      });
      const runnerUpStateBefore = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(runnerUpStateBefore, {
        walletCoins: 1000,
        awards: winnerStateAfterFirst.awards,
        stats: { matches: 5, wins: 1, kills: 42, prize_coins: 500 },
        ledger: [{ amount: 500, balance_after: 1000, reason: "match_prize" }],
        match: winnerStateAfterFirst.match,
      });

      const standingsBeforeFailure = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsBeforeFailure.status, 200);
      assert.equal(standingsBeforeFailure.body.status, "finalized");
      assert.deepEqual(standingsBeforeFailure.body.entries, [{
        rank: 1,
        kills: 7,
        prizeCoins: 500,
        gameName: "TestGame1",
        teamName: null,
      }]);

      await installRunnerUpLedgerFailure(runnerUp.userId);
      const failed = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(failed.status, 500, `expected injected database failure: ${JSON.stringify(failed.body)}`);

      const failureEvidence = await pool.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text, is_called FROM daily007_test_result_failure_observed_seq",
      );
      assert.equal(Number(failureEvidence.rows[0]?.last_value), 1);
      assert.equal(
        failureEvidence.rows[0]?.is_called,
        true,
        "the failure trigger must run after the runner-up award, stats, and wallet update are attempted",
      );

      assert.deepEqual(
        await captureSettlementState(fixture, winner),
        winnerStateAfterFirst,
        "the previously committed winner award, wallet, ledger, stats, and match state must remain unchanged",
      );
      assert.deepEqual(
        await captureSettlementState(fixture, runnerUp),
        runnerUpStateBefore,
        "the failed runner-up award, wallet credit, ledger row, and stats must all roll back",
      );
      const standingsAfterFailure = await publicStandings(origin, fixture.matchId);
      assert.deepEqual(
        standingsAfterFailure,
        standingsBeforeFailure,
        "the published winner standings must remain unchanged after the runner-up failure",
      );

      await removeRunnerUpLedgerFailure();
      const retry = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(retry.status, 201, `retry should succeed: ${JSON.stringify(retry.body)}`);
      assert.equal(retry.body.registrationId, runnerUp.registrationId);
      assert.equal(retry.body.userId, runnerUp.userId);
      assert.equal(retry.body.prizeCoins, 250);
      assert.equal(retry.body.walletCoins, 1250);

      const winnerAfterRetry = await captureSettlementState(fixture, winner);
      assert.equal(winnerAfterRetry.walletCoins, winnerStateAfterFirst.walletCoins);
      assert.deepEqual(winnerAfterRetry.stats, winnerStateAfterFirst.stats);
      assert.deepEqual(winnerAfterRetry.ledger, winnerStateAfterFirst.ledger);
      assert.deepEqual(winnerAfterRetry.match, winnerStateAfterFirst.match);
      assert.equal(winnerAfterRetry.awards.length, 2);
      assert.deepEqual(winnerAfterRetry.awards[0], winnerStateAfterFirst.awards[0]);

      const runnerUpAfterRetry = await captureSettlementState(fixture, runnerUp);
      assert.equal(runnerUpAfterRetry.walletCoins, 1250);
      assert.deepEqual(runnerUpAfterRetry.awards, [{
        registration_id: winner.registrationId,
        user_id: winner.userId,
        rank: 1,
        kills: 7,
        prize_coins: 500,
      }, {
        registration_id: runnerUp.registrationId,
        user_id: runnerUp.userId,
        rank: 2,
        kills: 3,
        prize_coins: 250,
      }]);
      assert.deepEqual(runnerUpAfterRetry.stats, {
        matches: 6,
        wins: 1,
        kills: 45,
        prize_coins: 750,
      });
      assert.deepEqual(
        [...runnerUpAfterRetry.ledger].sort((left, right) => left.balance_after - right.balance_after),
        [
          { amount: 500, balance_after: 1000, reason: "match_prize" },
          { amount: 250, balance_after: 1250, reason: "match_prize" },
        ],
      );
      assert.deepEqual(runnerUpAfterRetry.match, winnerStateAfterFirst.match);

      const standingsAfterRetry = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsAfterRetry.status, 200);
      assert.equal(standingsAfterRetry.body.status, "finalized");
      assert.deepEqual(standingsAfterRetry.body.entries, [
        {
          rank: 1,
          kills: 7,
          prizeCoins: 500,
          gameName: "TestGame1",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame2",
          teamName: null,
        },
      ]);

      const duplicate = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(duplicate.status, 409);
      assert.deepEqual(await captureSettlementState(fixture, runnerUp), runnerUpAfterRetry);
    });
  } finally {
    try {
      await removeRunnerUpLedgerFailure();
    } finally {
      await cleanupFixture(fixture);
    }
  }
});