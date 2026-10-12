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

test("an in-flight admin mutation commits before demotion, and later mutations are rejected", async () => {
  const actorId = randomUUID();
  const demoterId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740075n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let mutationPromise: Promise<JsonResponse> | undefined;
  let demotionPromise: Promise<JsonResponse> | undefined;

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

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      const [mutation, demotion] = await Promise.all([mutationPromise, demotionPromise]);
      assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));

      const laterMutation = await patchJson(origin, `/admin/users/${targetId}`, actorId, {
        coinsDelta: 1,
        reason: "must be rejected",
      });
      assert.equal(laterMutation.status, 403);
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
    if (mutationPromise || demotionPromise) {
      await Promise.allSettled([mutationPromise, demotionPromise].filter(Boolean) as Promise<JsonResponse>[]);
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
  } finally {
    if (approvalPromise) await Promise.allSettled([approvalPromise]);

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

test("opposing admin blocks serialize without a deadlock and reject the blocked admin", async () => {
  const firstAdminId = randomUUID();
  const secondAdminId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740080n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let firstBlockPromise: Promise<JsonResponse> | undefined;
  let secondBlockPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'First Opposing Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Second Opposing Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Opposing Block Wallet Target', $6, 'test-salt', 'test-hash', 'user', 100)`,
      [
        firstAdminId,
        `opposing-admin-one-${firstAdminId}@example.test`,
        secondAdminId,
        `opposing-admin-two-${secondAdminId}@example.test`,
        targetId,
        `opposing-wallet-target-${targetId}@example.test`,
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

        secondBlockPromise = patchJson(
          origin,
          `/admin/users/${firstAdminId}`,
          secondAdminId,
          { status: "blocked" },
        );
        await waitForQueryBlockedBy(
          "SELECT pg_advisory_xact_lock(740073)",
          "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
          "the opposing block request to queue behind the first status transaction",
        );

        await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
        pauseLockHeld = false;
        const [firstBlock, secondBlock] = await Promise.all([
          firstBlockPromise,
          secondBlockPromise,
        ]);
        assert.equal(firstBlock.status, 200, JSON.stringify(firstBlock.body));
        assert.equal(firstBlock.body.status, "blocked");
        assert.equal(secondBlock.status, 403, JSON.stringify(secondBlock.body));

        const laterAction = await patchJson(
          origin,
          `/admin/users/${targetId}`,
          secondAdminId,
          {
            coinsDelta: 1,
            reason: "blocked admin must not adjust wallets",
          },
        );
        assert.equal(laterAction.status, 403, JSON.stringify(laterAction.body));
      } finally {
        if (pauseLockHeld) {
          await blocker!
            .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
            .catch(() => undefined);
          pauseLockHeld = false;
        }
      }
    });

    const admins = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[firstAdminId, secondAdminId]],
    );
    assert.deepEqual(
      new Map(admins.rows.map(({ id, status }) => [id, status])),
      new Map([
        [firstAdminId, "active"],
        [secondAdminId, "blocked"],
      ]),
    );

    const target = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [targetId],
    );
    const ledger = await pool.query(
      "SELECT amount, reason FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );
    assert.equal(target.rows[0]?.wallet_coins, 100);
    assert.deepEqual(ledger.rows, []);
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    if (firstBlockPromise || secondBlockPromise) {
      await Promise.allSettled(
        [firstBlockPromise, secondBlockPromise].filter(
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
        pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [
          targetId,
        ]),
      () =>
        pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
          [firstAdminId, secondAdminId, targetId],
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
        "Failed to clean up the opposing admin block fixture.",
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
