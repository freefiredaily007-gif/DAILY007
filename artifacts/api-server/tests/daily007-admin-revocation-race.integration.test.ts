import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
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

test("an in-flight admin mutation commits before the actor is blocked, and later mutations are rejected", async () => {
  const actorId = randomUUID();
  const blockerAdminId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740077n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let mutationPromise: Promise<JsonResponse> | undefined;
  let blockPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'In-flight Admin to Block', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Blocking Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Block-Race Wallet Target', $6, 'test-salt', 'test-hash', 'user', 100)`,
      [
        actorId, `block-race-actor-${actorId}@example.test`,
        blockerAdminId, `block-race-blocker-${blockerAdminId}@example.test`,
        targetId, `block-race-target-${targetId}@example.test`,
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
        reason: "controlled block race",
      });
      await waitForBlockedQuery(
        "UPDATE daily007_v2_users SET status = COALESCE",
        "the already-authorized wallet mutation",
      );

      blockPromise = patchJson(origin, `/admin/users/${actorId}`, blockerAdminId, {
        status: "blocked",
      });
      await waitForQueryBlockedBy(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        "UPDATE daily007_v2_users SET status = COALESCE($2, status)",
        "the block request to wait for the in-flight admin mutation",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      const [mutation, blocked] = await Promise.all([mutationPromise, blockPromise]);
      assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
      assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
      assert.equal(blocked.body.status, "blocked");

      const laterMutation = await patchJson(origin, `/admin/users/${targetId}`, actorId, {
        coinsDelta: 1,
        reason: "must be rejected after blocking",
      });
      assert.equal(laterMutation.status, 403, JSON.stringify(laterMutation.body));
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
    assert.deepEqual(ledger.rows, [{
      amount: 25,
      reason: "admin_adjustment:controlled block race",
    }]);
  } finally {
    if (blocker) {
      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      blocker.release();
    }
    if (mutationPromise || blockPromise) {
      await Promise.allSettled(
        [mutationPromise, blockPromise].filter(Boolean) as Promise<JsonResponse>[],
      );
    }
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_wallet_update ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_wallet_update()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_users");
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [targetId]);
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[actorId, blockerAdminId, targetId]],
    );
  }
});