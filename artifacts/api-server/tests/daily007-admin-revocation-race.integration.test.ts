import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007AccountRecoveryRouter from "../src/routes/daily007-account-recovery";
import compatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007LeaderboardRouter from "../src/routes/daily007-leaderboards";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-admin-revocation-race-test-secret-at-least-32-chars";
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

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(compatExtraRouter);
  app.use(daily007LeaderboardRouter);
  app.use(daily007AccountRecoveryRouter);
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
  assert.ok(token, "The test account must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function patchJson(
  origin: string,
  path: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method: "PATCH",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function putJson(
  origin: string,
  path: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method: "PUT",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postJson(
  origin: string,
  path: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function getJson(
  origin: string,
  path: string,
  userId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, { headers: authHeaders(userId) });
  return { status: response.status, body: await response.json() };
}

async function seedRecoveryQueueRaceFixture(
  readerId: string,
  demoterId: string,
  playerId: string,
  requestId: string,
): Promise<{
  googleEmail: string;
  createdAt: string;
  accountName: string;
  accountEmail: string;
  phone: string;
  gameUid: string;
}> {
  const accountName = "Recovery Queue Player";
  const accountEmail = `recovery-player-${playerId}@example.test`;
  const googleEmail = `pending-google-${requestId}@example.test`;
  const phone = "+1-555-0199";
  const gameUid = `recovery-uid-${playerId}`;
  const createdAt = "2026-01-02T03:04:05.000Z";
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins, phone, game_uid)
     VALUES
       ($1, 'Recovery Queue Reader', $2, 'test-salt', 'test-hash', 'admin', 0, NULL, NULL),
       ($3, 'Recovery Queue Demoter', $4, 'test-salt', 'test-hash', 'admin', 0, NULL, NULL),
       ($5, $6, $7, 'test-salt', 'test-hash', 'user', 0, $8, $9)`,
    [
      readerId,
      `recovery-reader-${readerId}@example.test`,
      demoterId,
      `recovery-demoter-${demoterId}@example.test`,
      playerId,
      accountName,
      accountEmail,
      phone,
      gameUid,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_google_recovery_requests
       (id, user_id, google_clerk_user_id, google_email, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [requestId, playerId, `clerk-recovery-${requestId}`, googleEmail, createdAt],
  );
  return { googleEmail, createdAt, accountName, accountEmail, phone, gameUid };
}

async function seedFinancialReadRaceFixture(
  readerId: string,
  demoterId: string,
  playerId: string,
  paymentId: string,
  withdrawalId: string,
): Promise<{ email: string; payerUpiId: string; withdrawalAccount: string }> {
  const email = `financial-player-${playerId}@example.test`;
  const payerUpiId = `payer-${playerId}@upi`;
  const withdrawalAccount = `private-bank-account-${playerId}`;
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES
       ($1, 'Financial Read Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
       ($3, 'Financial Read Demoter', $4, 'test-salt', 'test-hash', 'admin', 0),
       ($5, 'Financial Player', $6, 'test-salt', 'test-hash', 'user', 0)`,
    [
      readerId,
      `financial-reader-${readerId}@example.test`,
      demoterId,
      `financial-demoter-${demoterId}@example.test`,
      playerId,
      email,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_payments
       (id, user_id, coins, amount, payer_upi_id, reference_normalized, reference, proof_object_path)
     VALUES ($1, $2, 30, 30, $3, $4, $4, $5)`,
    [
      paymentId,
      playerId,
      payerUpiId,
      `financial-payment-${paymentId}`,
      `/objects/uploads/daily007/payment-proofs/${playerId}/${randomUUID()}.png`,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_withdrawals
       (id, user_id, coins, method, account)
     VALUES ($1, $2, 25, 'UPI', $3)`,
    [withdrawalId, playerId, withdrawalAccount],
  );
  return { email, payerUpiId, withdrawalAccount };
}

async function seedTournamentWriteRaceFixture(
  tournamentAdminId: string,
  fullAdminId: string,
  matchId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES
       ($1, 'Tournament Write Admin', $2, 'test-salt', 'test-hash', 'tournament_admin', 0),
       ($3, 'Tournament Write Revoker', $4, 'test-salt', 'test-hash', 'admin', 0)`,
    [
      tournamentAdminId,
      `tournament-write-${tournamentAdminId}@example.test`,
      fullAdminId,
      `tournament-revoker-${fullAdminId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, starts_at, entry_coins, room_id, room_password)
     VALUES ($1, 'Original tournament', now() + interval '2 days', 5, 'original-room', 'original-password')`,
    [matchId],
  );
}

function startTournamentWriteRequests(
  origin: string,
  tournamentAdminId: string,
  matchId: string,
): Promise<JsonResponse>[] {
  const createdStartsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  return [
    postJson(origin, "/daily007/v2/admin/matches", tournamentAdminId, {
      title: "Race-created tournament",
      gameMode: "battle_royale",
      teamType: "solo",
      startsAt: createdStartsAt,
      entryCoins: 4,
    }),
    patchJson(origin, `/daily007/v2/admin/matches/${matchId}`, tournamentAdminId, {
      entryCoins: 73,
    }),
    putJson(origin, `/daily007/v2/admin/matches/${matchId}/room`, tournamentAdminId, {
      roomId: "updated-room",
      roomPassword: "updated-password",
    }),
  ];
}

async function waitForBlockedQuery(fragment: string, description: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query ILIKE $1
       ) AS waiting`,
      [`%${fragment}%`],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for the ${description} to block in PostgreSQL.`);
}

async function waitForBlockedQueryCountBy(
  waitingFragment: string,
  blockingFragment: string,
  expectedCount: number,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_stat_activity AS waiting
         CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(blocker_pid)
         JOIN pg_stat_activity AS blocker ON blocker.pid = blocker_pid
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $1
          AND blocker.query ILIKE $2`,
      [`%${waitingFragment}%`, `%${blockingFragment}%`],
    );
    if ((result.rows[0]?.count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} in PostgreSQL.`);
}

async function waitForQueryBlockedBy(
  waitingFragment: string,
  blockingFragment: string,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity AS waiting
           CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(blocker_pid)
           JOIN pg_stat_activity AS blocker ON blocker.pid = blocker_pid
          WHERE waiting.pid <> pg_backend_pid()
            AND waiting.wait_event_type = 'Lock'
            AND waiting.query ILIKE $1
            AND blocker.query ILIKE $2
       ) AS waiting`,
      [`%${waitingFragment}%`, `%${blockingFragment}%`],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} in PostgreSQL.`);
}

async function waitForQueryBlockedByPid(
  blockingPid: number,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity AS waiting
           CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(pid)
          WHERE waiting.pid <> pg_backend_pid()
            AND waiting.wait_event_type = 'Lock'
            AND blockers.pid = $1
       ) AS waiting`,
      [blockingPid],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} in PostgreSQL.`);
}

test("an in-flight admin mutation commits before demotion, and later mutations are rejected", async () => {
  const actorId = randomUUID();
  const demoterId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740075n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let mutationPromise: Promise<JsonResponse> | undefined;
  let demotionPromise: Promise<JsonResponse> | undefined;
  let queuedMutationPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'In-flight Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Demoting Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Wallet Target', $6, 'test-salt', 'test-hash', 'user', 100)`,
      [
        actorId, `actor-${actorId}@example.test`,
        demoterId, `demoter-${demoterId}@example.test`,
        targetId, `target-${targetId}@example.test`,
      ],
    );
    await pool.query("CREATE TABLE daily007_test_paused_users (id uuid PRIMARY KEY)");
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_wallet_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.wallet_coins IS DISTINCT FROM OLD.wallet_coins
           AND EXISTS (SELECT 1 FROM daily007_test_paused_users WHERE id = NEW.id) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_wallet_update
      BEFORE UPDATE ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_wallet_update()
    `);
    await pool.query("INSERT INTO daily007_test_paused_users (id) VALUES ($1)", [targetId]);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);

    await withServer(async (origin) => {
      let mutation: JsonResponse;
      let demotion: JsonResponse;
      let queuedMutation: JsonResponse;
      try {
        mutationPromise = patchJson(origin, `/admin/users/${targetId}`, actorId, {
          coinsDelta: 25,
          reason: "controlled race",
        });
        await waitForBlockedQuery(
          "UPDATE daily007_v2_users SET status = COALESCE",
          "the already-authorized wallet mutation",
        );

        demotionPromise = patchJson(origin, `/admin/users/${actorId}/role`, demoterId, {
          role: "tournament_admin",
        });
        await waitForBlockedQuery(
          "SELECT pg_advisory_xact_lock(740073)",
          "the role-change advisory lock",
        );
        const demotionBackend = await pool.query<{ pid: number }>(
          `SELECT pid
             FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%SELECT pg_advisory_xact_lock(740073)%'
            ORDER BY query_start DESC
            LIMIT 1`,
        );
        assert.ok(demotionBackend.rows[0], "the demotion should be queued behind the first mutation");

        queuedMutationPromise = patchJson(origin, `/admin/users/${targetId}`, actorId, {
          coinsDelta: 7,
          reason: "must be rejected after demotion",
        });
        await waitForQueryBlockedByPid(
          demotionBackend.rows[0].pid,
          "the later wallet adjustment to queue behind the demotion",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
        [mutation, demotion, queuedMutation] = await Promise.all([
          mutationPromise,
          demotionPromise,
          queuedMutationPromise,
        ]);
      } finally {
        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      }

      assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
      assert.equal(queuedMutation.status, 403, JSON.stringify(queuedMutation.body));
    });

    const actor = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [actorId],
    );
    const target = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [targetId],
    );
    const ledger = await pool.query<{ amount: number; reason: string }>(
      "SELECT amount, reason FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );
    assert.equal(actor.rows[0]?.role, "tournament_admin");
    assert.equal(target.rows[0]?.wallet_coins, 125);
    assert.deepEqual(ledger.rows, [{ amount: 25, reason: "admin_adjustment:controlled race" }]);
  } finally {
    if (blocker) {
      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      blocker.release();
    }
    if (mutationPromise || demotionPromise || queuedMutationPromise) {
      await Promise.allSettled(
        [mutationPromise, demotionPromise, queuedMutationPromise].filter(Boolean) as Promise<JsonResponse>[],
      );
    }
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_wallet_update ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_wallet_update()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_users");
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [[actorId, demoterId, targetId]]);
  }
});

test("a retry after a lost admin coin-adjustment response does not repeat the credit", async () => {
  const actorId = randomUUID();
  const targetId = randomUUID();
  const requestId = randomUUID();
  const separateRequestId = randomUUID();

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'Adjustment Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Adjustment Target', $4, 'test-salt', 'test-hash', 'user', 100)`,
      [actorId, `adjust-admin-${actorId}@example.test`, targetId, `adjust-target-${targetId}@example.test`],
    );
    await withServer(async (origin) => {
      const firstRequest = {
        coinsDelta: 25,
        note: "Admin added coins",
        requestId,
      };

      // The server commits successfully, but the simulated client discards the response.
      await patchJson(origin, `/admin/users/${targetId}`, actorId, firstRequest);
      const afterUnobservedCommit = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [targetId],
      );
      const ledgerAfterUnobservedCommit = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_wallet_ledger WHERE user_id = $1",
        [targetId],
      );
      assert.equal(afterUnobservedCommit.rows[0]?.wallet_coins, 125);
      assert.equal(ledgerAfterUnobservedCommit.rows[0]?.count, "1");

      const retry = await patchJson(origin, `/admin/users/${targetId}`, actorId, firstRequest);
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      assert.equal(retry.body.coins, 125);

      const separateAdjustment = await patchJson(origin, `/admin/users/${targetId}`, actorId, {
        ...firstRequest,
        requestId: separateRequestId,
      });
      assert.equal(separateAdjustment.status, 200, JSON.stringify(separateAdjustment.body));
      assert.equal(separateAdjustment.body.coins, 150);
    });

    const target = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [targetId],
    );
    const firstLedgerEntry = await pool.query<{
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT amount, balance_after, reason, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND idempotency_key = $2`,
      [targetId, `daily007-admin-adjustment:${actorId}:${requestId}`],
    );
    const separateLedgerEntry = await pool.query<{
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT amount, balance_after, reason, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND idempotency_key = $2`,
      [targetId, `daily007-admin-adjustment:${actorId}:${separateRequestId}`],
    );
    const ledgerCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );

    assert.equal(target.rows[0]?.wallet_coins, 150);
    assert.equal(ledgerCount.rows[0]?.count, "2");
    assert.deepEqual(firstLedgerEntry.rows[0], {
      amount: 25,
      balance_after: 125,
      reason: "admin_adjustment:Admin added coins",
      idempotency_key: `daily007-admin-adjustment:${actorId}:${requestId}`,
    });
    assert.deepEqual(separateLedgerEntry.rows[0], {
      amount: 25,
      balance_after: 150,
      reason: "admin_adjustment:Admin added coins",
      idempotency_key: `daily007-admin-adjustment:${actorId}:${separateRequestId}`,
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [[actorId, targetId]]);
  }
});

test("an in-flight leaderboard payout commits before demotion, and later approvals are rejected", async () => {
  const actorId = randomUUID();
  const demoterId = randomUUID();
  const winnerId = randomUUID();
  const periodId = randomUUID();
  const pauseKey = 740076n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let approvalPromise: Promise<JsonResponse> | undefined;
  let demotionPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'In-flight Leaderboard Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Leaderboard Demoting Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Leaderboard Winner', $6, 'test-salt', 'test-hash', 'user', 5)`,
      [
        actorId, `leaderboard-actor-${actorId}@example.test`,
        demoterId, `leaderboard-demoter-${demoterId}@example.test`,
        winnerId, `leaderboard-winner-${winnerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES ($1, 'weekly', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z',
               'pending_approval', $2::jsonb, $3::jsonb)`,
      [
        periodId,
        JSON.stringify([{
          rank: 1,
          userId: winnerId,
          name: "Leaderboard Winner",
          points: 10,
          earnings: 0,
          wins: 1,
          kills: 2,
          matches: 1,
        }]),
        JSON.stringify([{ rank: 1, coins: 40 }]),
      ],
    );
    await pool.query("CREATE TABLE daily007_test_paused_leaderboard_periods (id uuid PRIMARY KEY)");
    await pool.query(
      "INSERT INTO daily007_test_paused_leaderboard_periods (id) VALUES ($1)",
      [periodId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_leaderboard_payout() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM daily007_test_paused_leaderboard_periods
           WHERE id = (NEW.details->>'periodId')::uuid
        ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_leaderboard_payout
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_leaderboard_payout()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);

    await withServer(async (origin) => {
      approvalPromise = postJson(
        origin,
        `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`,
        actorId,
        {},
      );
      await waitForBlockedQuery(
        "INSERT INTO daily007_v2_wallet_ledger",
        "the in-flight leaderboard payout ledger insert",
      );

      demotionPromise = patchJson(origin, `/admin/users/${actorId}/role`, demoterId, {
        role: "tournament_admin",
      });
      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock(740073)",
        "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE",
        "the demotion to queue behind the in-flight approval's shared role lock",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      const [approval, demotion] = await Promise.all([approvalPromise, demotionPromise]);
      assert.equal(approval.status, 200, JSON.stringify(approval.body));
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));

      const laterApproval = await postJson(
        origin,
        `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`,
        actorId,
        {},
      );
      assert.equal(laterApproval.status, 403, JSON.stringify(laterApproval.body));
    });

    const actor = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [actorId],
    );
    const winner = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [winnerId],
    );
    const period = await pool.query<{ status: string; approved_by: string }>(
      "SELECT status, approved_by FROM daily007_v2_leaderboard_periods WHERE id = $1",
      [periodId],
    );
    const payouts = await pool.query<{ amount: number; balance_after: number; idempotency_key: string }>(
      "SELECT amount, balance_after, idempotency_key FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [winnerId],
    );
    assert.equal(actor.rows[0]?.role, "tournament_admin");
    assert.equal(winner.rows[0]?.wallet_coins, 45);
    assert.deepEqual(period.rows, [{ status: "finalized", approved_by: actorId }]);
    assert.deepEqual(payouts.rows, [{
      amount: 40,
      balance_after: 45,
      idempotency_key: `leaderboard-cycle:${periodId}:rank:1`,
    }]);
  } finally {
    if (blocker) {
      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      blocker.release();
    }
    if (approvalPromise || demotionPromise) {
      await Promise.allSettled(
        [approvalPromise, demotionPromise].filter(Boolean) as Promise<JsonResponse>[],
      );
    }
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_leaderboard_payout ON daily007_v2_wallet_ledger",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_leaderboard_payout()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_leaderboard_periods");
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [winnerId]);
    await pool.query("DELETE FROM daily007_v2_leaderboard_periods WHERE id = $1", [periodId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[actorId, demoterId, winnerId]],
    );
  }
});

test("concurrent approvals of one leaderboard period pay each rank only once", async () => {
  const firstAdminId = randomUUID();
  const secondAdminId = randomUUID();
  const winnerIds = [randomUUID(), randomUUID(), randomUUID()] as const;
  const winnerNames = [
    "Leaderboard Race Winner 1",
    "Leaderboard Race Winner 2",
    "Leaderboard Race Winner 3",
  ];
  const startingBalances = [11, 12, 13] as const;
  const periodId = randomUUID();
  const pauseKey = 740078n;
  const rewards = [
    { rank: 1, coins: 40 },
    { rank: 2, coins: 20 },
    { rank: 3, coins: 10 },
  ];
  const standings = winnerIds.map((userId, index) => ({
    rank: index + 1,
    userId,
    name: winnerNames[index],
    points: 30 - index * 10,
    earnings: 0,
    wins: 3 - index,
    kills: 4 - index,
    matches: 5 - index,
  }));
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let firstApprovalPromise: Promise<JsonResponse> | undefined;
  let secondApprovalPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'First Approval Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Second Approval Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, $6, $7, 'test-salt', 'test-hash', 'user', $8),
         ($9, $10, $11, 'test-salt', 'test-hash', 'user', $12),
         ($13, $14, $15, 'test-salt', 'test-hash', 'user', $16)`,
      [
        firstAdminId,
        `approval-admin-one-${firstAdminId}@example.test`,
        secondAdminId,
        `approval-admin-two-${secondAdminId}@example.test`,
        winnerIds[0],
        winnerNames[0],
        `approval-winner-one-${winnerIds[0]}@example.test`,
        startingBalances[0],
        winnerIds[1],
        winnerNames[1],
        `approval-winner-two-${winnerIds[1]}@example.test`,
        startingBalances[1],
        winnerIds[2],
        winnerNames[2],
        `approval-winner-three-${winnerIds[2]}@example.test`,
        startingBalances[2],
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES ($1, 'weekly', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z',
               'pending_approval', $2::jsonb, $3::jsonb)`,
      [periodId, JSON.stringify(standings), JSON.stringify(rewards)],
    );
    await pool.query(
      "CREATE TABLE daily007_test_paused_approval_race_periods (id uuid PRIMARY KEY)",
    );
    await pool.query(
      "INSERT INTO daily007_test_paused_approval_race_periods (id) VALUES ($1)",
      [periodId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_approval_race_payout() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM daily007_test_paused_approval_race_periods
           WHERE id = (NEW.details->>'periodId')::uuid
        ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_approval_race_payout
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_approval_race_payout()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);

    await withServer(async (origin) => {
      const approvalPath = `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`;
      firstApprovalPromise = postJson(origin, approvalPath, firstAdminId, {});
      await waitForBlockedQuery(
        "INSERT INTO daily007_v2_wallet_ledger",
        "the first concurrent leaderboard payout",
      );

      secondApprovalPromise = postJson(origin, approvalPath, secondAdminId, {});
      await waitForQueryBlockedBy(
        "hashtext",
        "INSERT INTO daily007_v2_wallet_ledger",
        "the second approval to queue behind the first payout transaction",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      const [firstApproval, secondApproval] = await Promise.all([
        firstApprovalPromise,
        secondApprovalPromise,
      ]);

      assert.equal(
        firstApproval.status,
        200,
        JSON.stringify(firstApproval.body),
      );
      assert.equal(firstApproval.body.periodId, periodId);
      assert.equal(firstApproval.body.alreadyApproved, false);
      assert.equal(firstApproval.body.approvedBy, firstAdminId);
      assert.deepEqual(
        (
          firstApproval.body.payouts as {
            rank: number;
            userId: string;
            name: string;
            coins: number;
            balanceAfter: number;
          }[]
        ).map(({ rank, userId, name, coins, balanceAfter }) => ({
          rank,
          userId,
          name,
          coins,
          balanceAfter,
        })),
        [
          {
            rank: 1,
            userId: winnerIds[0],
            name: winnerNames[0],
            coins: 40,
            balanceAfter: 51,
          },
          {
            rank: 2,
            userId: winnerIds[1],
            name: winnerNames[1],
            coins: 20,
            balanceAfter: 32,
          },
          {
            rank: 3,
            userId: winnerIds[2],
            name: winnerNames[2],
            coins: 10,
            balanceAfter: 23,
          },
        ],
      );

      assert.equal(
        secondApproval.status,
        200,
        JSON.stringify(secondApproval.body),
      );
      assert.equal(secondApproval.body.periodId, periodId);
      assert.equal(secondApproval.body.alreadyApproved, true);
      assert.equal(secondApproval.body.approvedBy, firstAdminId);
      assert.equal(
        secondApproval.body.approvedAt,
        firstApproval.body.approvedAt,
      );
      assert.deepEqual(
        secondApproval.body.standings,
        firstApproval.body.standings,
      );
      assert.deepEqual(secondApproval.body.rewards, firstApproval.body.rewards);
      assert.deepEqual(secondApproval.body.payouts, []);
    });

    const period = await pool.query<{
      status: string;
      approved_by: string;
      approved_at: Date;
      settled_at: Date;
    }>(
      `SELECT status, approved_by, approved_at, settled_at
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1`,
      [periodId],
    );
    assert.equal(period.rows[0]?.status, "finalized");
    assert.equal(period.rows[0]?.approved_by, firstAdminId);
    assert.ok(period.rows[0]?.approved_at instanceof Date);
    assert.ok(period.rows[0]?.settled_at instanceof Date);

    const winners = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [winnerIds],
    );
    assert.deepEqual(
      new Map(winners.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [winnerIds[0], 51],
        [winnerIds[1], 32],
        [winnerIds[2], 23],
      ]),
    );

    const payouts = await pool.query<{
      rank: number;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT (details->>'rank')::integer AS rank, user_id, amount, balance_after,
              reason, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE user_id = ANY($1::uuid[])
        ORDER BY (details->>'rank')::integer`,
      [winnerIds],
    );
    assert.deepEqual(payouts.rows, [
      {
        rank: 1,
        user_id: winnerIds[0],
        amount: 40,
        balance_after: 51,
        reason: "Weekly Leaderboard Rank #1 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:1`,
      },
      {
        rank: 2,
        user_id: winnerIds[1],
        amount: 20,
        balance_after: 32,
        reason: "Weekly Leaderboard Rank #2 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:2`,
      },
      {
        rank: 3,
        user_id: winnerIds[2],
        amount: 10,
        balance_after: 23,
        reason: "Weekly Leaderboard Rank #3 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:3`,
      },
    ]);
  } finally {
    if (blocker) {
      await blocker
        .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
        .catch(() => undefined);
      blocker.release();
    }
    if (firstApprovalPromise || secondApprovalPromise) {
      await Promise.allSettled(
        [firstApprovalPromise, secondApprovalPromise].filter(
          Boolean,
        ) as Promise<JsonResponse>[],
      );
    }

    const cleanupStatements = [
      "DROP TRIGGER IF EXISTS daily007_test_pause_approval_race_payout ON daily007_v2_wallet_ledger",
      "DROP FUNCTION IF EXISTS daily007_test_pause_approval_race_payout()",
      "DROP TABLE IF EXISTS daily007_test_paused_approval_race_periods",
    ];
    const cleanupErrors: unknown[] = [];
    for (const statement of cleanupStatements) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const cleanup of [
      () =>
        pool.query(
          "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
          [winnerIds],
        ),
      () =>
        pool.query(
          "DELETE FROM daily007_v2_leaderboard_periods WHERE id = $1",
          [periodId],
        ),
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [firstAdminId, secondAdminId, ...winnerIds],
        ]),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the concurrent leaderboard approval fixture.",
      );
    }
  }
});

test("concurrent approvals of separate leaderboard cycles add both rewards to the same winner", async () => {
  const weeklyAdminId = randomUUID();
  const monthlyAdminId = randomUUID();
  const winnerId = randomUUID();
  const weeklyPeriodId = randomUUID();
  const monthlyPeriodId = randomUUID();
  const winnerName = "Shared Weekly and Monthly Winner";
  const startingBalance = 17;
  const weeklyReward = 40;
  const monthlyReward = 25;
  const pauseKey = 740081n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let weeklyApprovalPromise: Promise<JsonResponse> | undefined;
  let monthlyApprovalPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'Weekly Approval Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Monthly Approval Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, $6, $7, 'test-salt', 'test-hash', 'user', $8)`,
      [
        weeklyAdminId,
        `weekly-approval-admin-${weeklyAdminId}@example.test`,
        monthlyAdminId,
        `monthly-approval-admin-${monthlyAdminId}@example.test`,
        winnerId,
        winnerName,
        `shared-cycle-winner-${winnerId}@example.test`,
        startingBalance,
      ],
    );
    const standings = [{
      rank: 1,
      userId: winnerId,
      name: winnerName,
      points: 50,
      earnings: 0,
      wins: 2,
      kills: 3,
      matches: 4,
    }];
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES
         ($1, 'weekly', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z',
          'pending_approval', $3::jsonb, $4::jsonb),
         ($2, 'monthly', '2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z',
          'pending_approval', $3::jsonb, $5::jsonb)`,
      [
        weeklyPeriodId,
        monthlyPeriodId,
        JSON.stringify(standings),
        JSON.stringify([{ rank: 1, coins: weeklyReward }]),
        JSON.stringify([{ rank: 1, coins: monthlyReward }]),
      ],
    );
    await pool.query(
      "CREATE TABLE daily007_test_paused_cycle_payouts (period_id uuid PRIMARY KEY)",
    );
    await pool.query(
      "INSERT INTO daily007_test_paused_cycle_payouts (period_id) VALUES ($1)",
      [weeklyPeriodId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_first_cycle_payout() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM daily007_test_paused_cycle_payouts
           WHERE period_id = (NEW.details->>'periodId')::uuid
        ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_first_cycle_payout
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_first_cycle_payout()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);

    await withServer(async (origin) => {
      let weeklyApproval: JsonResponse;
      let monthlyApproval: JsonResponse;
      try {
        weeklyApprovalPromise = postJson(
          origin,
          `/daily007/v2/admin/leaderboards/periods/${weeklyPeriodId}/approve`,
          weeklyAdminId,
          {},
        );
        await waitForBlockedQuery(
          "INSERT INTO daily007_v2_wallet_ledger",
          "the weekly payout after locking the shared winner",
        );
        const weeklyPayoutBackend = await pool.query<{ pid: number }>(
          `SELECT pid
             FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%INSERT INTO daily007_v2_wallet_ledger%'
            ORDER BY query_start DESC
            LIMIT 1`,
        );
        assert.ok(weeklyPayoutBackend.rows[0], "the weekly payout should be waiting on the test lock");

        monthlyApprovalPromise = postJson(
          origin,
          `/daily007/v2/admin/leaderboards/periods/${monthlyPeriodId}/approve`,
          monthlyAdminId,
          {},
        );
        await waitForQueryBlockedByPid(
          weeklyPayoutBackend.rows[0].pid,
          "the monthly payout to wait for the weekly winner balance update",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
        [weeklyApproval, monthlyApproval] = await Promise.all([
          weeklyApprovalPromise,
          monthlyApprovalPromise,
        ]);
      } finally {
        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      }

      assert.equal(weeklyApproval.status, 200, JSON.stringify(weeklyApproval.body));
      assert.equal(weeklyApproval.body.periodId, weeklyPeriodId);
      assert.equal(weeklyApproval.body.cycleType, "weekly");
      assert.equal(weeklyApproval.body.alreadyApproved, false);
      assert.equal(weeklyApproval.body.approvedBy, weeklyAdminId);
      assert.deepEqual(
        weeklyApproval.body.payouts,
        [{
          rank: 1,
          userId: winnerId,
          name: winnerName,
          coins: weeklyReward,
          balanceAfter: startingBalance + weeklyReward,
        }],
      );

      assert.equal(monthlyApproval.status, 200, JSON.stringify(monthlyApproval.body));
      assert.equal(monthlyApproval.body.periodId, monthlyPeriodId);
      assert.equal(monthlyApproval.body.cycleType, "monthly");
      assert.equal(monthlyApproval.body.alreadyApproved, false);
      assert.equal(monthlyApproval.body.approvedBy, monthlyAdminId);
      assert.deepEqual(
        monthlyApproval.body.payouts,
        [{
          rank: 1,
          userId: winnerId,
          name: winnerName,
          coins: monthlyReward,
          balanceAfter: startingBalance + weeklyReward + monthlyReward,
        }],
      );
    });

    const periods = await pool.query<{
      id: string;
      cycle_type: string;
      status: string;
      approved_by: string;
    }>(
      `SELECT id, cycle_type, status, approved_by
         FROM daily007_v2_leaderboard_periods
        WHERE id = ANY($1::uuid[])
        ORDER BY cycle_type`,
      [[weeklyPeriodId, monthlyPeriodId]],
    );
    assert.deepEqual(periods.rows, [
      { id: monthlyPeriodId, cycle_type: "monthly", status: "finalized", approved_by: monthlyAdminId },
      { id: weeklyPeriodId, cycle_type: "weekly", status: "finalized", approved_by: weeklyAdminId },
    ]);

    const winner = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [winnerId],
    );
    assert.equal(winner.rows[0]?.wallet_coins, startingBalance + weeklyReward + monthlyReward);

    const payouts = await pool.query<{
      period_id: string;
      rank: number;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT details->>'periodId' AS period_id,
              (details->>'rank')::integer AS rank,
              user_id,
              amount,
              balance_after,
              reason,
              idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1
        ORDER BY reason`,
      [winnerId],
    );
    assert.deepEqual(payouts.rows, [
      {
        period_id: monthlyPeriodId,
        rank: 1,
        user_id: winnerId,
        amount: monthlyReward,
        balance_after: startingBalance + weeklyReward + monthlyReward,
        reason: "Monthly Leaderboard Rank #1 Reward",
        idempotency_key: `leaderboard-cycle:${monthlyPeriodId}:rank:1`,
      },
      {
        period_id: weeklyPeriodId,
        rank: 1,
        user_id: winnerId,
        amount: weeklyReward,
        balance_after: startingBalance + weeklyReward,
        reason: "Weekly Leaderboard Rank #1 Reward",
        idempotency_key: `leaderboard-cycle:${weeklyPeriodId}:rank:1`,
      },
    ]);
  } finally {
    if (blocker) {
      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      blocker.release();
    }
    if (weeklyApprovalPromise || monthlyApprovalPromise) {
      await Promise.allSettled(
        [weeklyApprovalPromise, monthlyApprovalPromise].filter(Boolean) as Promise<JsonResponse>[],
      );
    }
    const cleanupErrors: unknown[] = [];
    for (const statement of [
      "DROP TRIGGER IF EXISTS daily007_test_pause_first_cycle_payout ON daily007_v2_wallet_ledger",
      "DROP FUNCTION IF EXISTS daily007_test_pause_first_cycle_payout()",
      "DROP TABLE IF EXISTS daily007_test_paused_cycle_payouts",
    ]) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const cleanup of [
      () => pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [winnerId]),
      () =>
        pool.query(
          "DELETE FROM daily007_v2_leaderboard_periods WHERE id = ANY($1::uuid[])",
          [[weeklyPeriodId, monthlyPeriodId]],
        ),
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [weeklyAdminId, monthlyAdminId, winnerId],
        ]),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the overlapping leaderboard cycle payout fixture.",
      );
    }
  }
});

test("a later leaderboard payout failure rolls back earlier winners and keeps the period pending", async () => {
  const adminId = randomUUID();
  const winnerIds = [randomUUID(), randomUUID(), randomUUID()] as const;
  const winnerNames = [
    "Rollback Test Winner 1",
    "Rollback Test Winner 2",
    "Rollback Test Winner 3",
  ];
  const startingBalances = [11, 12, 13] as const;
  const periodId = randomUUID();
  const failureSequence = "daily007_test_leaderboard_payout_failure_attempts";
  let approvalPromise: Promise<JsonResponse> | undefined;
  let retryApprovalPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'Payout Failure Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, $4, $5, 'test-salt', 'test-hash', 'user', $6),
         ($7, $8, $9, 'test-salt', 'test-hash', 'user', $10),
         ($11, $12, $13, 'test-salt', 'test-hash', 'user', $14)`,
      [
        adminId,
        `payout-failure-admin-${adminId}@example.test`,
        winnerIds[0],
        winnerNames[0],
        `payout-failure-winner-one-${winnerIds[0]}@example.test`,
        startingBalances[0],
        winnerIds[1],
        winnerNames[1],
        `payout-failure-winner-two-${winnerIds[1]}@example.test`,
        startingBalances[1],
        winnerIds[2],
        winnerNames[2],
        `payout-failure-winner-three-${winnerIds[2]}@example.test`,
        startingBalances[2],
      ],
    );

    const standings = winnerIds.map((userId, index) => ({
      rank: index + 1,
      userId,
      name: winnerNames[index],
      points: 30 - index * 10,
      earnings: 0,
      wins: 3 - index,
      kills: 4 - index,
      matches: 5 - index,
    }));
    const rewards = [
      { rank: 1, coins: 40 },
      { rank: 2, coins: 20 },
      { rank: 3, coins: 10 },
    ];
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES ($1, 'weekly', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z',
               'pending_approval', $2::jsonb, $3::jsonb)`,
      [periodId, JSON.stringify(standings), JSON.stringify(rewards)],
    );

    await pool.query(`CREATE SEQUENCE ${failureSequence}`);
    await pool.query(`
      CREATE FUNCTION daily007_test_fail_later_leaderboard_payout() RETURNS trigger AS $$
      BEGIN
        IF NEW.idempotency_key = 'leaderboard-cycle:${periodId}:rank:2' THEN
          IF NOT EXISTS (
            SELECT 1
              FROM daily007_v2_wallet_ledger
             WHERE idempotency_key = 'leaderboard-cycle:${periodId}:rank:1'
               AND user_id = '${winnerIds[0]}'::uuid
               AND amount = 40
               AND balance_after = 51
          ) THEN
            RAISE EXCEPTION 'The first rank payout was not visible before the injected failure';
          END IF;
          IF (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${winnerIds[0]}'::uuid) <> 51 THEN
            RAISE EXCEPTION 'The first winner balance was not updated before the injected failure';
          END IF;
          PERFORM nextval('${failureSequence}');
          RAISE EXCEPTION 'Injected failure on a later leaderboard rank payout';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_fail_later_leaderboard_payout
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_fail_later_leaderboard_payout()
    `);

    await withServer(async (origin) => {
      approvalPromise = postJson(
        origin,
        `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`,
        adminId,
        {},
      );
      const approval = await approvalPromise;
      assert.equal(approval.status, 500, JSON.stringify(approval.body));
      assert.equal(
        approval.body.error,
        "Test server encountered an unexpected error.",
      );
    });

    const failureObserved = await pool.query<{
      last_value: string;
      is_called: boolean;
    }>(`SELECT last_value::text, is_called FROM ${failureSequence}`);
    assert.deepEqual(
      failureObserved.rows[0],
      { last_value: "1", is_called: true },
      "the failure trigger must observe the earlier rank's ledger write and wallet update",
    );

    const period = await pool.query<{
      status: string;
      approved_by: string | null;
      approved_at: Date | null;
      settled_at: Date | null;
    }>(
      `SELECT status, approved_by, approved_at, settled_at
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1`,
      [periodId],
    );
    assert.deepEqual(period.rows, [
      {
        status: "pending_approval",
        approved_by: null,
        approved_at: null,
        settled_at: null,
      },
    ]);

    const winners = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [winnerIds],
    );
    assert.deepEqual(
      new Map(winners.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [winnerIds[0], startingBalances[0]],
        [winnerIds[1], startingBalances[1]],
        [winnerIds[2], startingBalances[2]],
      ]),
      "every winner balance must return to its pre-approval value",
    );

    const payoutRows = await pool.query(
      `SELECT idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE idempotency_key LIKE $1`,
      [`leaderboard-cycle:${periodId}:rank:%`],
    );
    assert.deepEqual(
      payoutRows.rows,
      [],
      "no payout ledger entries may remain from the failed approval",
    );

    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_fail_later_leaderboard_payout ON daily007_v2_wallet_ledger",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_later_leaderboard_payout()");

    await withServer(async (origin) => {
      retryApprovalPromise = postJson(
        origin,
        `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`,
        adminId,
        {},
      );
      const retry = await retryApprovalPromise;
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      assert.equal(retry.body.periodId, periodId);
      assert.equal(retry.body.cycleType, "weekly");
      assert.equal(retry.body.alreadyApproved, false);
      assert.equal(retry.body.approvedBy, adminId);
      assert.deepEqual(
        (
          retry.body.payouts as {
            rank: number;
            userId: string;
            name: string;
            coins: number;
            balanceAfter: number;
          }[]
        ).map(({ rank, userId, name, coins, balanceAfter }) => ({
          rank,
          userId,
          name,
          coins,
          balanceAfter,
        })),
        [
          {
            rank: 1,
            userId: winnerIds[0],
            name: winnerNames[0],
            coins: 40,
            balanceAfter: 51,
          },
          {
            rank: 2,
            userId: winnerIds[1],
            name: winnerNames[1],
            coins: 20,
            balanceAfter: 32,
          },
          {
            rank: 3,
            userId: winnerIds[2],
            name: winnerNames[2],
            coins: 10,
            balanceAfter: 23,
          },
        ],
      );

      for (const [index, expected] of [
        { rank: 1, coins: 40, balanceAfter: 51 },
        { rank: 2, coins: 20, balanceAfter: 32 },
        { rank: 3, coins: 10, balanceAfter: 23 },
      ].entries()) {
        const history = await getJson(origin, "/wallet/transactions", winnerIds[index]);
        assert.equal(history.status, 200, JSON.stringify(history.body));
        assert.ok(Array.isArray(history.body));
        assert.equal(history.body.length, 1);
        const [transaction] = history.body as {
          amount: number;
          balanceAfter: number;
          reason: string;
          description: string;
          details: { periodId: string; cycleType: string; rank: number };
        }[];
        assert.deepEqual(
          {
            amount: transaction.amount,
            balanceAfter: transaction.balanceAfter,
            reason: transaction.reason,
            description: transaction.description,
            periodId: transaction.details.periodId,
            cycleType: transaction.details.cycleType,
            rank: transaction.details.rank,
          },
          {
            amount: expected.coins,
            balanceAfter: expected.balanceAfter,
            reason: `Weekly Leaderboard Rank #${expected.rank} Reward`,
            description: `Weekly Leaderboard Rank #${expected.rank} Reward`,
            periodId,
            cycleType: "weekly",
            rank: expected.rank,
          },
        );
      }
    });

    const retriedPeriod = await pool.query<{
      status: string;
      approved_by: string | null;
      approved_at: Date | null;
      settled_at: Date | null;
    }>(
      `SELECT status, approved_by, approved_at, settled_at
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1`,
      [periodId],
    );
    assert.equal(retriedPeriod.rows[0]?.status, "finalized");
    assert.equal(retriedPeriod.rows[0]?.approved_by, adminId);
    assert.ok(retriedPeriod.rows[0]?.approved_at instanceof Date);
    assert.ok(retriedPeriod.rows[0]?.settled_at instanceof Date);

    const retriedWinners = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [winnerIds],
    );
    assert.deepEqual(
      new Map(retriedWinners.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [winnerIds[0], 51],
        [winnerIds[1], 32],
        [winnerIds[2], 23],
      ]),
    );

    const retriedPayoutRows = await pool.query<{
      rank: number;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT (details->>'rank')::integer AS rank,
              user_id,
              amount,
              balance_after,
              reason,
              idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE user_id = ANY($1::uuid[])
        ORDER BY (details->>'rank')::integer`,
      [winnerIds],
    );
    assert.deepEqual(retriedPayoutRows.rows, [
      {
        rank: 1,
        user_id: winnerIds[0],
        amount: 40,
        balance_after: 51,
        reason: "Weekly Leaderboard Rank #1 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:1`,
      },
      {
        rank: 2,
        user_id: winnerIds[1],
        amount: 20,
        balance_after: 32,
        reason: "Weekly Leaderboard Rank #2 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:2`,
      },
      {
        rank: 3,
        user_id: winnerIds[2],
        amount: 10,
        balance_after: 23,
        reason: "Weekly Leaderboard Rank #3 Reward",
        idempotency_key: `leaderboard-cycle:${periodId}:rank:3`,
      },
    ]);
  } finally {
    await Promise.allSettled(
      [approvalPromise, retryApprovalPromise].filter(Boolean) as Promise<JsonResponse>[],
    );

    const cleanupStatements = [
      "DROP TRIGGER IF EXISTS daily007_test_fail_later_leaderboard_payout ON daily007_v2_wallet_ledger",
      "DROP FUNCTION IF EXISTS daily007_test_fail_later_leaderboard_payout()",
      `DROP SEQUENCE IF EXISTS ${failureSequence}`,
    ];
    const cleanupErrors: unknown[] = [];
    for (const statement of cleanupStatements) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const cleanup of [
      () =>
        pool.query(
          "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
          [winnerIds],
        ),
      () =>
        pool.query(
          "DELETE FROM daily007_v2_leaderboard_periods WHERE id = $1",
          [periodId],
        ),
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [adminId, ...winnerIds],
        ]),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the failed leaderboard payout fixture.",
      );
    }
  }
});

test("a leaderboard finalization failure rolls back every completed rank payout", async () => {
  const adminId = randomUUID();
  const winnerIds = [randomUUID(), randomUUID(), randomUUID()] as const;
  const winnerNames = [
    "Finalization Failure Winner 1",
    "Finalization Failure Winner 2",
    "Finalization Failure Winner 3",
  ];
  const startingBalances = [11, 12, 13] as const;
  const periodId = randomUUID();
  const failureSequence = "daily007_test_leaderboard_finalize_failure_attempts";
  let approvalPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'Finalization Failure Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, $4, $5, 'test-salt', 'test-hash', 'user', $6),
         ($7, $8, $9, 'test-salt', 'test-hash', 'user', $10),
         ($11, $12, $13, 'test-salt', 'test-hash', 'user', $14)`,
      [
        adminId,
        `finalization-failure-admin-${adminId}@example.test`,
        winnerIds[0],
        winnerNames[0],
        `finalization-failure-winner-one-${winnerIds[0]}@example.test`,
        startingBalances[0],
        winnerIds[1],
        winnerNames[1],
        `finalization-failure-winner-two-${winnerIds[1]}@example.test`,
        startingBalances[1],
        winnerIds[2],
        winnerNames[2],
        `finalization-failure-winner-three-${winnerIds[2]}@example.test`,
        startingBalances[2],
      ],
    );
    const standings = winnerIds.map((userId, index) => ({
      rank: index + 1,
      userId,
      name: winnerNames[index],
      points: 30 - index * 10,
      earnings: 0,
      wins: 3 - index,
      kills: 4 - index,
      matches: 5 - index,
    }));
    const rewards = [
      { rank: 1, coins: 40 },
      { rank: 2, coins: 20 },
      { rank: 3, coins: 10 },
    ];
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES ($1, 'weekly', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z',
               'pending_approval', $2::jsonb, $3::jsonb)`,
      [periodId, JSON.stringify(standings), JSON.stringify(rewards)],
    );

    await pool.query(`CREATE SEQUENCE ${failureSequence}`);
    await pool.query(`
      CREATE FUNCTION daily007_test_fail_leaderboard_finalization() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${periodId}'::uuid
           AND OLD.status = 'pending_approval'
           AND NEW.status = 'finalized' THEN
          IF (
            SELECT count(*)
              FROM daily007_v2_wallet_ledger
             WHERE idempotency_key LIKE 'leaderboard-cycle:${periodId}:rank:%'
          ) <> 3 THEN
            RAISE EXCEPTION 'All rank payouts were not visible before finalization';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM daily007_v2_wallet_ledger
             WHERE idempotency_key = 'leaderboard-cycle:${periodId}:rank:1'
               AND user_id = '${winnerIds[0]}'::uuid
               AND amount = 40 AND balance_after = 51
          ) OR NOT EXISTS (
            SELECT 1 FROM daily007_v2_wallet_ledger
             WHERE idempotency_key = 'leaderboard-cycle:${periodId}:rank:2'
               AND user_id = '${winnerIds[1]}'::uuid
               AND amount = 20 AND balance_after = 32
          ) OR NOT EXISTS (
            SELECT 1 FROM daily007_v2_wallet_ledger
             WHERE idempotency_key = 'leaderboard-cycle:${periodId}:rank:3'
               AND user_id = '${winnerIds[2]}'::uuid
               AND amount = 10 AND balance_after = 23
          ) THEN
            RAISE EXCEPTION 'Rank payout ledger values were not visible before finalization';
          END IF;
          IF (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${winnerIds[0]}'::uuid) <> 51
             OR (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${winnerIds[1]}'::uuid) <> 32
             OR (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${winnerIds[2]}'::uuid) <> 23 THEN
            RAISE EXCEPTION 'All winner balances were not updated before finalization';
          END IF;
          PERFORM nextval('${failureSequence}');
          RAISE EXCEPTION 'Injected failure while finalizing leaderboard period';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_fail_leaderboard_finalization
      BEFORE UPDATE ON daily007_v2_leaderboard_periods
      FOR EACH ROW EXECUTE FUNCTION daily007_test_fail_leaderboard_finalization()
    `);

    await withServer(async (origin) => {
      approvalPromise = postJson(
        origin,
        `/daily007/v2/admin/leaderboards/periods/${periodId}/approve`,
        adminId,
        {},
      );
      const approval = await approvalPromise;
      assert.equal(approval.status, 500, JSON.stringify(approval.body));
    });

    const failureObserved = await pool.query<{ last_value: string; is_called: boolean }>(
      `SELECT last_value::text, is_called FROM ${failureSequence}`,
    );
    assert.deepEqual(
      failureObserved.rows[0],
      { last_value: "1", is_called: true },
      "the trigger must observe all three payouts before failing finalization",
    );

    const period = await pool.query<{
      status: string;
      approved_by: string | null;
      approved_at: Date | null;
      settled_at: Date | null;
    }>(
      `SELECT status, approved_by, approved_at, settled_at
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1`,
      [periodId],
    );
    assert.deepEqual(period.rows, [{
      status: "pending_approval",
      approved_by: null,
      approved_at: null,
      settled_at: null,
    }]);

    const winners = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [winnerIds],
    );
    assert.deepEqual(
      new Map(winners.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map(winnerIds.map((winnerId, index) => [winnerId, startingBalances[index]])),
      "all winner balances must return to their starting values",
    );

    const payoutRows = await pool.query(
      `SELECT idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE idempotency_key LIKE $1`,
      [`leaderboard-cycle:${periodId}:rank:%`],
    );
    assert.deepEqual(payoutRows.rows, [], "no payout ledger rows may remain after rollback");
  } finally {
    if (approvalPromise) await Promise.allSettled([approvalPromise]);

    const cleanupErrors: unknown[] = [];
    for (const statement of [
      "DROP TRIGGER IF EXISTS daily007_test_fail_leaderboard_finalization ON daily007_v2_leaderboard_periods",
      "DROP FUNCTION IF EXISTS daily007_test_fail_leaderboard_finalization()",
      `DROP SEQUENCE IF EXISTS ${failureSequence}`,
    ]) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const cleanup of [
      () =>
        pool.query(
          "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
          [winnerIds],
        ),
      () =>
        pool.query("DELETE FROM daily007_v2_leaderboard_periods WHERE id = $1", [periodId]),
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [adminId, ...winnerIds],
        ]),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the leaderboard finalization failure fixture.",
      );
    }
  }
});

test("a protected mutation queued behind an admin block is rejected before writing", async () => {
  const actorId = randomUUID();
  const blockerAdminId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740077n;
  const blockPauseKey = 740079n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let blockPauseLockHeld = false;
  let mutationPromise: Promise<JsonResponse> | undefined;
  let blockPromise: Promise<JsonResponse> | undefined;
  let queuedMutationPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'In-flight Admin to Block', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Blocking Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Block-Race Wallet Target', $6, 'test-salt', 'test-hash', 'user', 100)`,
      [
        actorId,
        `block-race-actor-${actorId}@example.test`,
        blockerAdminId,
        `block-race-blocker-${blockerAdminId}@example.test`,
        targetId,
        `block-race-target-${targetId}@example.test`,
      ],
    );
    await pool.query(
      "CREATE TABLE daily007_test_paused_users (id uuid PRIMARY KEY)",
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_wallet_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.wallet_coins IS DISTINCT FROM OLD.wallet_coins
           AND EXISTS (SELECT 1 FROM daily007_test_paused_users WHERE id = NEW.id) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        IF NEW.id = '${actorId}'::uuid
           AND NEW.status = 'blocked'
           AND OLD.status IS DISTINCT FROM NEW.status THEN
          PERFORM pg_advisory_xact_lock(${blockPauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_wallet_update
      BEFORE UPDATE ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_wallet_update()
    `);
    await pool.query(
      "INSERT INTO daily007_test_paused_users (id) VALUES ($1)",
      [targetId],
    );

    blocker = await pool.connect();
    await blocker.query(
      `SELECT pg_advisory_lock(${pauseKey}::bigint),
              pg_advisory_lock(${blockPauseKey}::bigint)`,
    );
    pauseLockHeld = true;
    blockPauseLockHeld = true;

    await withServer(async (origin) => {
      try {
        mutationPromise = patchJson(
          origin,
          `/admin/users/${targetId}`,
          actorId,
          {
            coinsDelta: 25,
            reason: "controlled block race",
          },
        );
        await waitForBlockedQuery(
          "UPDATE daily007_v2_users SET status = COALESCE",
          "the already-authorized wallet mutation",
        );

        blockPromise = patchJson(
          origin,
          `/admin/users/${actorId}`,
          blockerAdminId,
          {
            status: "blocked",
          },
        );
        await waitForQueryBlockedBy(
          "SELECT pg_advisory_xact_lock(740073)",
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the block request to queue behind the in-flight admin mutation",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
        pauseLockHeld = false;
        await waitForBlockedQuery(
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the block update to hold the actor row lock before commit",
        );

        queuedMutationPromise = patchJson(
          origin,
          `/admin/users/${targetId}`,
          actorId,
          {
            coinsDelta: 1,
            reason: "must be rejected after blocking",
          },
        );
        await waitForQueryBlockedBy(
          "SELECT pg_advisory_xact_lock_shared(740073)",
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the second protected write to wait behind the in-flight block update",
        );

        await blocker!.query(
          `SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`,
        );
        blockPauseLockHeld = false;
        const [mutation, blocked, queuedMutation] = await Promise.all([
          mutationPromise,
          blockPromise,
          queuedMutationPromise,
        ]);
        assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
        assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
        assert.equal(blocked.body.status, "blocked");
        assert.equal(
          queuedMutation.status,
          403,
          JSON.stringify(queuedMutation.body),
        );
      } finally {
        if (blockPauseLockHeld) {
          await blocker!
            .query(`SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`)
            .catch(() => undefined);
          blockPauseLockHeld = false;
        }
        if (pauseLockHeld) {
          await blocker!
            .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
            .catch(() => undefined);
          pauseLockHeld = false;
        }
      }
    });

    const actor = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_users WHERE id = $1",
      [actorId],
    );
    const target = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [targetId],
    );
    const ledger = await pool.query<{ amount: number; reason: string }>(
      "SELECT amount, reason FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );
    assert.equal(actor.rows[0]?.status, "blocked");
    assert.equal(target.rows[0]?.wallet_coins, 125);
    assert.deepEqual(ledger.rows, [
      {
        amount: 25,
        reason: "admin_adjustment:controlled block race",
      },
    ]);
  } finally {
    if (blocker) {
      if (blockPauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`)
          .catch(() => undefined);
      }
      if (pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    if (mutationPromise || blockPromise || queuedMutationPromise) {
      await Promise.allSettled(
        [mutationPromise, blockPromise, queuedMutationPromise].filter(
          Boolean,
        ) as Promise<JsonResponse>[],
      );
    }
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_wallet_update ON daily007_v2_users",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS daily007_test_pause_wallet_update()",
    );
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_users");
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[actorId, blockerAdminId, targetId]],
    );
  }
});

test("a Tournament Admin result queued behind a block is rejected without publishing", async () => {
  const tournamentAdminId = randomUUID();
  const blockerAdminId = randomUUID();
  const playerId = randomUUID();
  const tournamentId = randomUUID();
  const registrationId = randomUUID();
  const blockPauseKey = 740081n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockPauseLockHeld = false;
  let blockPromise: Promise<JsonResponse> | undefined;
  let resultPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'Tournament Admin to Block', $2, 'test-salt', 'test-hash', 'tournament_admin', 0),
         ($3, 'Tournament Blocker Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Result Race Player', $6, 'test-salt', 'test-hash', 'user', 5)`,
      [
        tournamentAdminId,
        `tournament-admin-block-race-${tournamentAdminId}@example.test`,
        blockerAdminId,
        `tournament-block-race-admin-${blockerAdminId}@example.test`,
        playerId,
        `tournament-block-race-player-${playerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches
         (id, title, prize_pool, prize_distribution, starts_at, status, enabled)
       VALUES ($1, 'Queued Result Block Race', 50, '1: 50', now() - interval '1 day', 'active', true)`,
      [tournamentId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations (id, match_id, captain_user_id, status)
       VALUES ($1, $2, $3, 'approved')`,
      [registrationId, tournamentId, playerId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_tournament_admin_block() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${tournamentAdminId}'::uuid
           AND NEW.status = 'blocked'
           AND OLD.status IS DISTINCT FROM NEW.status THEN
          PERFORM pg_advisory_xact_lock(${blockPauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_tournament_admin_block
      BEFORE UPDATE ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_tournament_admin_block()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${blockPauseKey}::bigint)`);
    blockPauseLockHeld = true;

    await withServer(async (origin) => {
      try {
        blockPromise = patchJson(
          origin,
          `/admin/users/${tournamentAdminId}`,
          blockerAdminId,
          { status: "blocked" },
        );
        await waitForBlockedQuery(
          "UPDATE daily007_v2_users SET status = COALESCE",
          "the block update to hold the Tournament Admin row lock",
        );

        resultPromise = postJson(origin, "/admin/results", tournamentAdminId, {
          tournamentId,
          registrationId,
          rank: 1,
          kills: 2,
        });
        await waitForQueryBlockedBy(
          "SELECT pg_advisory_xact_lock_shared(740073)",
          "UPDATE daily007_v2_users SET status = COALESCE",
          "the tournament result write to queue behind the in-flight block",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`);
        blockPauseLockHeld = false;
        const [blocked, result] = await Promise.all([blockPromise, resultPromise]);
        assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
        assert.equal(blocked.body.status, "blocked");
        assert.equal(result.status, 403, JSON.stringify(result.body));
      } finally {
        if (blockPauseLockHeld) {
          await blocker!
            .query(`SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`)
            .catch(() => undefined);
          blockPauseLockHeld = false;
        }
      }
    });

    const blockedAdmin = await pool.query<{ status: string; role: string }>(
      "SELECT status, role FROM daily007_v2_users WHERE id = $1",
      [tournamentAdminId],
    );
    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [tournamentId],
    );
    const player = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [playerId],
    );
    const awards = await pool.query(
      "SELECT id FROM daily007_v2_result_awards WHERE match_id = $1",
      [tournamentId],
    );
    const stats = await pool.query(
      "SELECT user_id FROM daily007_v2_user_stats WHERE user_id = $1",
      [playerId],
    );
    const ledger = await pool.query(
      "SELECT id FROM daily007_v2_wallet_ledger WHERE match_id = $1",
      [tournamentId],
    );
    assert.deepEqual(blockedAdmin.rows, [{ status: "blocked", role: "tournament_admin" }]);
    assert.deepEqual(match.rows, [{ status: "active", enabled: true }]);
    assert.equal(player.rows[0]?.wallet_coins, 5);
    assert.deepEqual(awards.rows, []);
    assert.deepEqual(stats.rows, []);
    assert.deepEqual(ledger.rows, []);
  } finally {
    if (blocker) {
      if (blockPauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${blockPauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    if (blockPromise || resultPromise) {
      await Promise.allSettled(
        [blockPromise, resultPromise].filter(Boolean) as Promise<JsonResponse>[],
      );
    }
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_tournament_admin_block ON daily007_v2_users",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_tournament_admin_block()");
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = $1", [tournamentId]);
    await pool.query("DELETE FROM daily007_v2_user_stats WHERE user_id = $1", [playerId]);
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE match_id = $1", [tournamentId]);
    await pool.query("DELETE FROM daily007_v2_registrations WHERE id = $1", [registrationId]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [tournamentId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[tournamentAdminId, blockerAdminId, playerId]],
    );
  }
});

test("a blocked admin cannot complete a role change queued behind the block", async () => {
  const firstAdminId = randomUUID();
  const secondAdminId = randomUUID();
  const pauseKey = 740080n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let firstBlockPromise: Promise<JsonResponse> | undefined;
  let roleChangePromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'First Role-Change Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Admin to Block Before Role Change', $4, 'test-salt', 'test-hash', 'admin', 0)`,
      [
        firstAdminId,
        `role-change-first-admin-${firstAdminId}@example.test`,
        secondAdminId,
        `role-change-blocked-admin-${secondAdminId}@example.test`,
      ],
    );
    await pool.query(
      "CREATE TABLE daily007_test_paused_admin_blocks (id uuid PRIMARY KEY)",
    );
    await pool.query(
      "INSERT INTO daily007_test_paused_admin_blocks (id) VALUES ($1)",
      [secondAdminId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_admin_block() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM daily007_test_paused_admin_blocks
           WHERE id = NEW.id
        )
           AND NEW.status = 'blocked'
           AND OLD.status IS DISTINCT FROM NEW.status THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_admin_block
      BEFORE UPDATE ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_admin_block()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    await withServer(async (origin) => {
      try {
        firstBlockPromise = patchJson(
          origin,
          `/admin/users/${secondAdminId}`,
          firstAdminId,
          { status: "blocked" },
        );
        await waitForBlockedQuery(
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the first block update after it acquired its transaction locks",
        );

        roleChangePromise = patchJson(
          origin,
          `/admin/users/${firstAdminId}/role`,
          secondAdminId,
          { role: "tournament_admin" },
        );
        await waitForQueryBlockedBy(
          "SELECT pg_advisory_xact_lock(740073)",
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the blocked admin's role change to queue behind the in-flight block",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
        pauseLockHeld = false;
        const [firstBlock, roleChange] = await Promise.all([
          firstBlockPromise,
          roleChangePromise,
        ]);
        assert.equal(firstBlock.status, 200, JSON.stringify(firstBlock.body));
        assert.equal(firstBlock.body.status, "blocked");
        assert.equal(roleChange.status, 403, JSON.stringify(roleChange.body));
      } finally {
        if (pauseLockHeld) {
          await blocker!
            .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
            .catch(() => undefined);
          pauseLockHeld = false;
        }
      }
    });

    const admins = await pool.query<{ id: string; status: string; role: string }>(
      "SELECT id, status, role FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[firstAdminId, secondAdminId]],
    );
    assert.deepEqual(
      new Map(admins.rows.map(({ id, status, role }) => [id, { status, role }])),
      new Map([
        [firstAdminId, { status: "active", role: "admin" }],
        [secondAdminId, { status: "blocked", role: "admin" }],
      ]),
    );
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    if (firstBlockPromise || roleChangePromise) {
      await Promise.allSettled(
        [firstBlockPromise, roleChangePromise].filter(
          Boolean,
        ) as Promise<JsonResponse>[],
      );
    }

    const cleanupStatements = [
      "DROP TRIGGER IF EXISTS daily007_test_pause_admin_block ON daily007_v2_users",
      "DROP FUNCTION IF EXISTS daily007_test_pause_admin_block()",
      "DROP TABLE IF EXISTS daily007_test_paused_admin_blocks",
    ];
    const cleanupErrors: unknown[] = [];
    for (const statement of cleanupStatements) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const cleanup of [
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [firstAdminId, secondAdminId],
        ]),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up the blocked admin role-change fixture.",
      );
    }
  }
});

test("a recovery queue read waiting behind a committed demotion returns no recovery details", async () => {
  const readerId = randomUUID();
  const demoterId = randomUUID();
  const playerId = randomUUID();
  const requestId = randomUUID();
  const pauseKey = 740081n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let demotionPromise: Promise<JsonResponse> | undefined;
  let queuePromise: Promise<{ status: number; body: unknown }> | undefined;

  try {
    const fixture = await seedRecoveryQueueRaceFixture(readerId, demoterId, playerId, requestId);
    await pool.query("CREATE TABLE daily007_test_paused_recovery_demotions (id uuid PRIMARY KEY)");
    await pool.query(
      "INSERT INTO daily007_test_paused_recovery_demotions (id) VALUES ($1)",
      [readerId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_recovery_demotion() RETURNS trigger AS $$
      BEGIN
        IF OLD.role = 'admin'
           AND NEW.role = 'tournament_admin'
           AND EXISTS (
             SELECT 1 FROM daily007_test_paused_recovery_demotions WHERE id = NEW.id
           ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_recovery_demotion
      BEFORE UPDATE OF role ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_recovery_demotion()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    await withServer(async (origin) => {
      demotionPromise = patchJson(origin, `/admin/users/${readerId}/role`, demoterId, {
        role: "tournament_admin",
      });
      await waitForBlockedQuery(
        "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role",
        "the demotion to pause after it holds the exclusive role-change lock",
      );

      queuePromise = getJson(origin, "/admin/account-recovery-requests", readerId);
      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock_shared(740073)",
        "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role",
        "the recovery queue role check to wait behind the demotion",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      pauseLockHeld = false;
      const [demotion, queue] = await Promise.all([demotionPromise, queuePromise]);
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
      assert.equal(queue.status, 403, JSON.stringify(queue.body));
      assert.deepEqual(queue.body, { error: "Administrator access is required." });
      assert.equal(JSON.stringify(queue.body).includes(fixture.googleEmail), false);
    });

    const reader = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [readerId],
    );
    assert.equal(reader.rows[0]?.role, "tournament_admin");
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      }
      blocker.release();
    }
    if (demotionPromise || queuePromise) {
      await Promise.allSettled(
        [demotionPromise, queuePromise].filter(Boolean) as Promise<unknown>[],
      );
    }
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_recovery_demotion ON daily007_v2_users",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_recovery_demotion()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_recovery_demotions");
    await pool.query("DELETE FROM daily007_v2_google_recovery_requests WHERE id = $1", [requestId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[readerId, demoterId, playerId]],
    );
  }
});

test("a concurrent demotion waits until an authorized recovery queue read finishes", async () => {
  const readerId = randomUUID();
  const demoterId = randomUUID();
  const playerId = randomUUID();
  const requestId = randomUUID();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let tableLockHeld = false;
  let demotionPromise: Promise<JsonResponse> | undefined;
  let queuePromise: Promise<{ status: number; body: unknown }> | undefined;

  try {
    const fixture = await seedRecoveryQueueRaceFixture(readerId, demoterId, playerId, requestId);
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "LOCK TABLE daily007_v2_google_recovery_requests IN ACCESS EXCLUSIVE MODE",
    );
    tableLockHeld = true;

    await withServer(async (origin) => {
      queuePromise = getJson(origin, "/admin/account-recovery-requests", readerId);
      await waitForBlockedQuery(
        "FROM daily007_v2_google_recovery_requests r",
        "the authorized recovery queue query after the reader's role check",
      );

      demotionPromise = patchJson(origin, `/admin/users/${readerId}/role`, demoterId, {
        role: "tournament_admin",
      });
      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock(740073)",
        "FROM daily007_v2_google_recovery_requests r",
        "the demotion to wait for the in-flight recovery queue read",
      );

      await blocker!.query("COMMIT");
      tableLockHeld = false;
      const [queue, demotion] = await Promise.all([queuePromise, demotionPromise]);
      assert.equal(queue.status, 200, JSON.stringify(queue.body));
      assert.deepEqual(queue.body, [{
        id: requestId,
        userId: playerId,
        googleEmail: fixture.googleEmail,
        createdAt: fixture.createdAt,
        accountName: fixture.accountName,
        accountEmail: fixture.accountEmail,
        phone: fixture.phone,
        gameUid: fixture.gameUid,
        accountRole: "user",
      }]);
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));

      const afterDemotion = await getJson(origin, "/admin/account-recovery-requests", readerId);
      assert.equal(afterDemotion.status, 403);
      assert.deepEqual(afterDemotion.body, { error: "Administrator access is required." });
      assert.equal(JSON.stringify(afterDemotion.body).includes(fixture.googleEmail), false);
    });

    const reader = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [readerId],
    );
    assert.equal(reader.rows[0]?.role, "tournament_admin");
  } finally {
    if (blocker) {
      if (tableLockHeld) {
        await blocker.query("ROLLBACK").catch(() => undefined);
      }
      blocker.release();
    }
    if (demotionPromise || queuePromise) {
      await Promise.allSettled(
        [demotionPromise, queuePromise].filter(Boolean) as Promise<unknown>[],
      );
    }
    await pool.query("DELETE FROM daily007_v2_google_recovery_requests WHERE id = $1", [requestId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[readerId, demoterId, playerId]],
    );
  }
});

test("financial reads queued behind an admin demotion return no private payment details", async () => {
  const readerId = randomUUID();
  const demoterId = randomUUID();
  const playerId = randomUUID();
  const paymentId = randomUUID();
  const withdrawalId = randomUUID();
  const pauseKey = 740082n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let demotionPromise: Promise<JsonResponse> | undefined;
  let readPromises: Promise<{ status: number; body: unknown }>[] = [];

  try {
    const fixture = await seedFinancialReadRaceFixture(
      readerId,
      demoterId,
      playerId,
      paymentId,
      withdrawalId,
    );
    await pool.query("CREATE TABLE daily007_test_paused_financial_demotions (id uuid PRIMARY KEY)");
    await pool.query(
      "INSERT INTO daily007_test_paused_financial_demotions (id) VALUES ($1)",
      [readerId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_financial_demotion() RETURNS trigger AS $$
      BEGIN
        IF OLD.role = 'admin'
           AND NEW.role = 'tournament_admin'
           AND EXISTS (
             SELECT 1 FROM daily007_test_paused_financial_demotions WHERE id = NEW.id
           ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_financial_demotion
      BEFORE UPDATE OF role ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_financial_demotion()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    await withServer(async (origin) => {
      demotionPromise = patchJson(origin, `/admin/users/${readerId}/role`, demoterId, {
        role: "tournament_admin",
      });
      const demotionQuery = "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role";
      await waitForBlockedQuery(
        demotionQuery,
        "the financial-read demotion to pause while holding the exclusive role gate",
      );

      readPromises = [
        getJson(origin, "/admin/payments", readerId),
        getJson(origin, `/admin/payments/${paymentId}/proof-url`, readerId),
        getJson(origin, "/admin/withdrawals", readerId),
      ];
      await waitForBlockedQueryCountBy(
        "SELECT pg_advisory_xact_lock_shared(740073)",
        demotionQuery,
        readPromises.length,
        "all financial reads to queue behind the demotion",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      pauseLockHeld = false;
      const [demotion, ...reads] = await Promise.all([demotionPromise, ...readPromises]);
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
      assert.deepEqual(reads.map((read) => read.status), [403, 403, 403]);
      for (const read of reads) {
        assert.deepEqual(read.body, { error: "Administrator access is required." });
        const serialized = JSON.stringify(read.body);
        assert.equal(serialized.includes(fixture.email), false);
        assert.equal(serialized.includes(fixture.payerUpiId), false);
        assert.equal(serialized.includes(fixture.withdrawalAccount), false);
        assert.equal(serialized.includes("https://"), false);
      }
    });

    const reader = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [readerId],
    );
    assert.equal(reader.rows[0]?.role, "tournament_admin");
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      }
      blocker.release();
    }
    if (demotionPromise || readPromises.length > 0) {
      await Promise.allSettled([demotionPromise, ...readPromises].filter(Boolean) as Promise<unknown>[]);
    }
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_financial_demotion ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_financial_demotion()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_financial_demotions");
    await pool.query("DELETE FROM daily007_v2_payments WHERE id = $1", [paymentId]);
    await pool.query("DELETE FROM daily007_v2_withdrawals WHERE id = $1", [withdrawalId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[readerId, demoterId, playerId]],
    );
  }
});

test("financial reads already under the admin role gate finish before demotion", async () => {
  const readerId = randomUUID();
  const demoterId = randomUUID();
  const playerId = randomUUID();
  const paymentId = randomUUID();
  const withdrawalId = randomUUID();
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  const originalFetch = globalThis.fetch;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let tableLockHeld = false;
  let demotionPromise: Promise<JsonResponse> | undefined;
  let paymentRead: Promise<{ status: number; body: unknown }> | undefined;
  let proofRead: Promise<{ status: number; body: unknown }> | undefined;
  let withdrawalRead: Promise<{ status: number; body: unknown }> | undefined;
  let markSignerStarted: (() => void) | undefined;
  let releaseSigner: ((response: Response) => void) | undefined;
  let signerReleased = false;
  const signerStarted = new Promise<void>((resolve) => { markSignerStarted = resolve; });
  const heldSignerResponse = new Promise<Response>((resolve) => { releaseSigner = resolve; });

  try {
    const fixture = await seedFinancialReadRaceFixture(
      readerId,
      demoterId,
      playerId,
      paymentId,
      withdrawalId,
    );
    process.env.PRIVATE_OBJECT_DIR = "daily007-test-bucket";
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "http://127.0.0.1:1106/object-storage/signed-object-url") {
        markSignerStarted?.();
        return heldSignerResponse;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "LOCK TABLE daily007_v2_payments, daily007_v2_withdrawals IN ACCESS EXCLUSIVE MODE",
    );
    tableLockHeld = true;

    await withServer(async (origin) => {
      paymentRead = getJson(origin, "/admin/payments", readerId);
      proofRead = getJson(origin, `/admin/payments/${paymentId}/proof-url`, readerId);
      withdrawalRead = getJson(origin, "/admin/withdrawals", readerId);
      await Promise.all([
        waitForBlockedQuery(
          "FROM daily007_v2_payments p JOIN",
          "the authorized payments read after its role check",
        ),
        waitForBlockedQuery(
          "SELECT proof_object_path FROM daily007_v2_payments",
          "the authorized proof lookup after its role check",
        ),
        waitForBlockedQuery(
          "FROM daily007_v2_withdrawals w JOIN",
          "the authorized withdrawals read after its role check",
        ),
      ]);

      demotionPromise = patchJson(origin, `/admin/users/${readerId}/role`, demoterId, {
        role: "tournament_admin",
      });
      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock(740073)",
        "SELECT proof_object_path FROM daily007_v2_payments",
        "the demotion to wait for the in-flight proof read",
      );

      await blocker!.query("COMMIT");
      tableLockHeld = false;
      await signerStarted;
      const [payments, withdrawals] = await Promise.all([paymentRead, withdrawalRead]);
      assert.equal(payments.status, 200, JSON.stringify(payments.body));
      assert.equal(withdrawals.status, 200, JSON.stringify(withdrawals.body));
      assert.equal(JSON.stringify(payments.body).includes(fixture.payerUpiId), true);
      assert.equal(JSON.stringify(payments.body).includes(fixture.email), true);
      assert.equal(JSON.stringify(withdrawals.body).includes(fixture.withdrawalAccount), true);
      assert.equal(JSON.stringify(withdrawals.body).includes(fixture.email), true);

      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock(740073)",
        "SELECT proof_object_path FROM daily007_v2_payments",
        "the demotion to keep waiting until the proof URL has been prepared",
      );
      releaseSigner?.(new Response(JSON.stringify({
        signed_url: "https://storage.example.test/financial-proof",
      }), { status: 200, headers: { "content-type": "application/json" } }));
      signerReleased = true;

      const [proof, demotion] = await Promise.all([proofRead, demotionPromise]);
      assert.equal(proof.status, 200, JSON.stringify(proof.body));
      assert.deepEqual(proof.body, { url: "https://storage.example.test/financial-proof" });
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
    });

    const reader = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [readerId],
    );
    assert.equal(reader.rows[0]?.role, "tournament_admin");
  } finally {
    if (blocker) {
      if (tableLockHeld) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    if (!signerReleased) {
      releaseSigner?.(new Response(JSON.stringify({
        signed_url: "https://storage.example.test/financial-proof",
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    globalThis.fetch = originalFetch;
    if (demotionPromise || paymentRead || proofRead || withdrawalRead) {
      await Promise.allSettled(
        [demotionPromise, paymentRead, proofRead, withdrawalRead].filter(Boolean) as Promise<unknown>[],
      );
    }
    await pool.query("DELETE FROM daily007_v2_payments WHERE id = $1", [paymentId]);
    await pool.query("DELETE FROM daily007_v2_withdrawals WHERE id = $1", [withdrawalId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[readerId, demoterId, playerId]],
    );
    if (privateObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = privateObjectDir;
  }
});

test("tournament writes already under the shared role gate finish before access is revoked", async () => {
  const tournamentAdminId = randomUUID();
  const fullAdminId = randomUUID();
  const matchId = randomUUID();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let tableLockHeld = false;
  let writePromises: Promise<JsonResponse>[] = [];
  let demotionPromise: Promise<JsonResponse> | undefined;

  try {
    await seedTournamentWriteRaceFixture(tournamentAdminId, fullAdminId, matchId);
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE daily007_v2_matches IN ACCESS EXCLUSIVE MODE");
    tableLockHeld = true;

    await withServer(async (origin) => {
      writePromises = startTournamentWriteRequests(origin, tournamentAdminId, matchId);
      await Promise.all([
        waitForBlockedQuery(
          "INSERT INTO daily007_v2_matches",
          "the authorized match creation after its role check",
        ),
        waitForBlockedQuery(
          "SET entry_coins = COALESCE",
          "the authorized match update after its role check",
        ),
        waitForBlockedQuery(
          "SET room_id = $2",
          "the authorized room save after its role check",
        ),
      ]);

      demotionPromise = patchJson(
        origin,
        `/admin/users/${tournamentAdminId}/role`,
        fullAdminId,
        { role: "user" },
      );
      await waitForQueryBlockedBy(
        "SELECT pg_advisory_xact_lock(740073)",
        "SET entry_coins = COALESCE",
        "the role revocation to wait for the authorized tournament writes",
      );

      await blocker!.query("COMMIT");
      tableLockHeld = false;
      const [created, updated, roomSaved, demotion] = await Promise.all([
        ...writePromises,
        demotionPromise,
      ]);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(roomSaved.status, 200, JSON.stringify(roomSaved.body));
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
    });

    const matches = await pool.query<{
      id: string;
      entry_coins: number;
      room_id: string | null;
      room_password: string | null;
      room_published: boolean;
    }>(
      `SELECT id, entry_coins, room_id, room_password, room_published
         FROM daily007_v2_matches
        WHERE id = $1 OR title = 'Race-created tournament'`,
      [matchId],
    );
    assert.equal(matches.rows.length, 2);
    const existing = matches.rows.find((row) => row.id === matchId);
    const created = matches.rows.find((row) => row.id !== matchId);
    assert.deepEqual(existing, {
      id: matchId,
      entry_coins: 73,
      room_id: "updated-room",
      room_password: "updated-password",
      room_published: true,
    });
    assert.ok(created);
    assert.equal(created.entry_coins, 4);

    const actor = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [tournamentAdminId],
    );
    assert.equal(actor.rows[0]?.role, "user");
  } finally {
    if (blocker) {
      if (tableLockHeld) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    await Promise.allSettled([...writePromises, demotionPromise].filter(Boolean) as Promise<unknown>[]);
    await pool.query(
      "DELETE FROM daily007_v2_matches WHERE id = $1 OR title = 'Race-created tournament'",
      [matchId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[tournamentAdminId, fullAdminId]],
    );
  }
});

test("tournament writes queued behind access revocation are denied without changing the match", async () => {
  const tournamentAdminId = randomUUID();
  const fullAdminId = randomUUID();
  const matchId = randomUUID();
  const pauseKey = 740084n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let writePromises: Promise<JsonResponse>[] = [];
  let demotionPromise: Promise<JsonResponse> | undefined;

  try {
    await seedTournamentWriteRaceFixture(tournamentAdminId, fullAdminId, matchId);
    await pool.query("CREATE TABLE daily007_test_paused_tournament_demotions (id uuid PRIMARY KEY)");
    await pool.query(
      "INSERT INTO daily007_test_paused_tournament_demotions (id) VALUES ($1)",
      [tournamentAdminId],
    );
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_tournament_demotion() RETURNS trigger AS $$
      BEGIN
        IF OLD.role = 'tournament_admin'
           AND NEW.role = 'user'
           AND EXISTS (
             SELECT 1 FROM daily007_test_paused_tournament_demotions WHERE id = NEW.id
           ) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_tournament_demotion
      BEFORE UPDATE OF role ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_tournament_demotion()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    const beforeMatch = await pool.query(
      `SELECT id, title, entry_coins, room_id, room_password, room_published
         FROM daily007_v2_matches WHERE id = $1`,
      [matchId],
    );
    const beforeCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM daily007_v2_matches",
    );

    await withServer(async (origin) => {
      demotionPromise = patchJson(
        origin,
        `/admin/users/${tournamentAdminId}/role`,
        fullAdminId,
        { role: "user" },
      );
      const roleUpdate = "UPDATE daily007_v2_users SET role = $2 WHERE id = $1 RETURNING id, role";
      await waitForBlockedQuery(
        roleUpdate,
        "the demotion to pause after acquiring the exclusive role gate",
      );

      writePromises = startTournamentWriteRequests(origin, tournamentAdminId, matchId);
      await waitForBlockedQueryCountBy(
        "SELECT pg_advisory_xact_lock_shared(740073)",
        roleUpdate,
        writePromises.length,
        "all stale tournament writes to queue behind the demotion",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      pauseLockHeld = false;
      const [demotion, ...writes] = await Promise.all([demotionPromise, ...writePromises]);
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));
      assert.deepEqual(writes.map((write) => write.status), [403, 403, 403]);
      for (const write of writes) {
        assert.deepEqual(write.body, { error: "Tournament administrator access is required." });
      }
    });

    const afterMatch = await pool.query(
      `SELECT id, title, entry_coins, room_id, room_password, room_published
         FROM daily007_v2_matches WHERE id = $1`,
      [matchId],
    );
    const afterCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM daily007_v2_matches",
    );
    assert.deepEqual(afterMatch.rows, beforeMatch.rows);
    assert.equal(afterCount.rows[0]?.count, beforeCount.rows[0]?.count);

    const actor = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [tournamentAdminId],
    );
    assert.equal(actor.rows[0]?.role, "user");
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      }
      blocker.release();
    }
    await Promise.allSettled([...writePromises, demotionPromise].filter(Boolean) as Promise<unknown>[]);
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_tournament_demotion ON daily007_v2_users",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_tournament_demotion()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_tournament_demotions");
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [matchId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[tournamentAdminId, fullAdminId]],
    );
  }
});
