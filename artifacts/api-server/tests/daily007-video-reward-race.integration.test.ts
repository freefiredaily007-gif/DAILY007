import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "daily007-video-race-test-secret-32-characters";
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

type TestFixture = {
  adminId: string | null;
  playerId: string | null;
  videoId: string | null;
  sessionId: string | null;
  additionalVideoIds: string[];
  additionalSessionIds: string[];
};

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

type SessionInsertOutcome =
  | { kind: "inserted"; sessionId: string }
  | { kind: "failed"; error: unknown };

async function withServer(
  run: (origin: string) => Promise<void>,
  beforeClose: () => Promise<void> = async () => undefined,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatExtraRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Internal server error." });
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
    await beforeClose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function authHeaders(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function sendJson(
  origin: string,
  path: string,
  userId: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function sendPermanentDelete(
  origin: string,
  videoId: string,
  adminId: string,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}/admin/videos/${videoId}`, {
    method: "DELETE",
    headers: authHeaders(adminId),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

async function createFixture(
  options: { includeInitialSession?: boolean } = {},
): Promise<TestFixture> {
  const fixture: TestFixture = {
    adminId: null,
    playerId: null,
    videoId: null,
    sessionId: null,
    additionalVideoIds: [],
    additionalSessionIds: [],
  };
  const suffix = randomUUID();
  try {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_users (name, email, password_salt, password_hash, role)
       VALUES ('Video race test admin', $1, 'test-salt', 'test-hash', 'admin')
       RETURNING id`,
      [`video-race-admin-${suffix}@example.test`],
    );
    fixture.adminId = admin.rows[0]?.id ?? null;
    assert.ok(fixture.adminId, "test admin should be created");

    const player = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_users
         (name, email, password_salt, password_hash, wallet_coins)
       VALUES ('Video race test player', $1, 'test-salt', 'test-hash', 12)
       RETURNING id`,
      [`video-race-player-${suffix}@example.test`],
    );
    fixture.playerId = player.rows[0]?.id ?? null;
    assert.ok(fixture.playerId, "test player should be created");

    const youtubeId = suffix.replace(/-/g, "").slice(0, 11);
    const video = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_videos (title, topic, youtube_id, created_by)
       VALUES ('Video race test', 'Concurrency', $1, $2)
       RETURNING id`,
      [youtubeId, fixture.adminId],
    );
    fixture.videoId = video.rows[0]?.id ?? null;
    assert.ok(fixture.videoId, "test video should be created");

    if (options.includeInitialSession ?? true) {
      const session = await pool.query<{ id: string }>(
        `INSERT INTO daily007_v2_video_watch_sessions
           (user_id, video_id, duration_seconds, started_at)
         VALUES ($1, $2, 5, now() - interval '30 seconds')
         RETURNING id`,
        [fixture.playerId, fixture.videoId],
      );
      fixture.sessionId = session.rows[0]?.id ?? null;
      assert.ok(fixture.sessionId, "test watch session should be created");
    }
    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: TestFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (fixture.playerId) {
      const sessions = await client.query<{ id: string }>(
        `SELECT id FROM daily007_v2_video_watch_sessions
          WHERE user_id = $1`,
        [fixture.playerId],
      );
      const sessionIds = new Set(sessions.rows.map((session) => session.id));
      if (fixture.sessionId) sessionIds.add(fixture.sessionId);
      for (const sessionId of fixture.additionalSessionIds) sessionIds.add(sessionId);
      for (const sessionId of sessionIds) {
        await client.query("DELETE FROM daily007_v2_video_watch_sessions WHERE id = $1", [
          sessionId,
        ]);
        await client.query(
          "DELETE FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1",
          [`daily007-video-watch:${sessionId}`],
        );
      }
    }
    for (const videoId of [fixture.videoId, ...fixture.additionalVideoIds]) {
      if (videoId) await client.query("DELETE FROM daily007_v2_videos WHERE id = $1", [videoId]);
    }
    if (fixture.playerId) {
      await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.playerId]);
    }
    if (fixture.adminId) {
      await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.adminId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshotUnrelatedVideoState(videoId: string): Promise<{
  videos: unknown[];
  watchSessions: unknown[];
}> {
  const [videos, watchSessions] = await Promise.all([
    pool.query(
      "SELECT * FROM daily007_v2_videos WHERE id <> $1 ORDER BY id",
      [videoId],
    ),
    pool.query(
      "SELECT * FROM daily007_v2_video_watch_sessions WHERE video_id <> $1 ORDER BY id",
      [videoId],
    ),
  ]);
  return { videos: videos.rows, watchSessions: watchSessions.rows };
}

async function backendPid(client: { query<T>(sql: string): Promise<{ rows: T[] }> }): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  assert.ok(result.rows[0]?.pid, "PostgreSQL should report this connection's backend id");
  return Number(result.rows[0].pid);
}

async function waitForBlockedBackend(
  queryFragment: string,
  blockerPids: number[],
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT activity.pid
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query LIKE $1
          AND pg_blocking_pids(activity.pid) && $2::int[]
        ORDER BY activity.query_start
        LIMIT 1`,
      [`%${queryFragment}%`, blockerPids],
    );
    const pid = result.rows[0]?.pid;
    if (pid) return Number(pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for PostgreSQL to block query containing "${queryFragment}".`,
  );
}

async function inspectFixture(fixture: TestFixture): Promise<{
  active: boolean;
  walletCoins: number;
  completedAt: Date | null;
  rewardLedgerId: string | null;
  ledgerCount: number;
  ledgerId: string | null;
  ledgerAmount: number | null;
  ledgerBalanceAfter: number | null;
}> {
  assert.ok(fixture.playerId && fixture.videoId && fixture.sessionId);
  const result = await pool.query<{
    active: boolean;
    walletCoins: number;
    completedAt: Date | null;
    rewardLedgerId: string | null;
    ledgerCount: number;
    ledgerId: string | null;
    ledgerAmount: number | null;
    ledgerBalanceAfter: number | null;
  }>(
    `SELECT video.active,
            player.wallet_coins AS "walletCoins",
            session.completed_at AS "completedAt",
            session.reward_ledger_id AS "rewardLedgerId",
            COUNT(ledger.id)::int AS "ledgerCount",
            MIN(ledger.id::text) AS "ledgerId",
            MIN(ledger.amount) AS "ledgerAmount",
            MIN(ledger.balance_after) AS "ledgerBalanceAfter"
       FROM daily007_v2_video_watch_sessions session
       JOIN daily007_v2_videos video ON video.id = session.video_id
       JOIN daily007_v2_users player ON player.id = session.user_id
       LEFT JOIN daily007_v2_wallet_ledger ledger
         ON ledger.user_id = player.id
        AND ledger.idempotency_key = $4
      WHERE session.id = $1 AND player.id = $2 AND video.id = $3
      GROUP BY video.active, player.wallet_coins, session.completed_at, session.reward_ledger_id`,
    [
      fixture.sessionId,
      fixture.playerId,
      fixture.videoId,
      `daily007-video-watch:${fixture.sessionId}`,
    ],
  );
  assert.ok(result.rows[0], "test fixture rows should still exist");
  return result.rows[0];
}

async function listFixtureWatchSessions(fixture: TestFixture): Promise<Array<{
  id: string;
  durationSeconds: number;
  startAttemptId: string | null;
  startedAt: Date | string;
  completedAt: Date | string | null;
  rewardLedgerId: string | null;
  videoActive: boolean;
}>> {
  assert.ok(fixture.playerId && fixture.videoId);
  const result = await pool.query<{
    id: string;
    durationSeconds: number;
    startAttemptId: string | null;
    startedAt: Date | string;
    completedAt: Date | string | null;
    rewardLedgerId: string | null;
    videoActive: boolean;
  }>(
    `SELECT session.id,
            session.duration_seconds AS "durationSeconds",
            session.start_attempt_id AS "startAttemptId",
            session.started_at AS "startedAt",
            session.completed_at AS "completedAt",
            session.reward_ledger_id AS "rewardLedgerId",
            video.active AS "videoActive"
       FROM daily007_v2_video_watch_sessions session
       JOIN daily007_v2_videos video ON video.id = session.video_id
      WHERE session.user_id = $1 AND session.video_id = $2
      ORDER BY session.started_at, session.id`,
    [fixture.playerId, fixture.videoId],
  );
  return result.rows;
}

async function inspectConcurrentSessions(
  fixture: TestFixture,
  sessionIds: [string, string],
): Promise<{
  walletCoins: number;
  rewardLedgerCount: number;
  sessions: Array<{
    sessionId: string;
    rewardLedgerId: string | null;
    completedAt: Date | null;
    videoActive: boolean;
    ledgerId: string | null;
    ledgerAmount: number | null;
    ledgerBalanceAfter: number | null;
    idempotencyKey: string | null;
  }>;
}> {
  assert.ok(fixture.playerId);
  const [sessionResult, ledgerCountResult] = await Promise.all([
    pool.query<{
      sessionId: string;
      rewardLedgerId: string | null;
      completedAt: Date | null;
      videoActive: boolean;
      walletCoins: number;
      ledgerId: string | null;
      ledgerAmount: number | null;
      ledgerBalanceAfter: number | null;
      idempotencyKey: string | null;
    }>(
      `SELECT session.id::text AS "sessionId",
              session.reward_ledger_id::text AS "rewardLedgerId",
              session.completed_at AS "completedAt",
              video.active AS "videoActive",
              player.wallet_coins AS "walletCoins",
              ledger.id::text AS "ledgerId",
              ledger.amount AS "ledgerAmount",
              ledger.balance_after AS "ledgerBalanceAfter",
              ledger.idempotency_key AS "idempotencyKey"
         FROM daily007_v2_video_watch_sessions session
         JOIN daily007_v2_videos video ON video.id = session.video_id
         JOIN daily007_v2_users player ON player.id = session.user_id
         LEFT JOIN daily007_v2_wallet_ledger ledger
           ON ledger.user_id = session.user_id
          AND ledger.idempotency_key = 'daily007-video-watch:' || session.id::text
        WHERE session.user_id = $1
          AND (session.id = $2 OR session.id = $3)
        ORDER BY session.id`,
      [fixture.playerId, ...sessionIds],
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND reason = 'video_watch_reward'`,
      [fixture.playerId],
    ),
  ]);
  assert.equal(sessionResult.rows.length, 2, "both watch sessions should remain in the fixture");
  return {
    walletCoins: Number(sessionResult.rows[0]?.walletCoins),
    rewardLedgerCount: Number(ledgerCountResult.rows[0]?.count ?? 0),
    sessions: sessionResult.rows.map((session) => ({
      sessionId: session.sessionId,
      rewardLedgerId: session.rewardLedgerId,
      completedAt: session.completedAt,
      videoActive: session.videoActive,
      ledgerId: session.ledgerId,
      ledgerAmount: session.ledgerAmount,
      ledgerBalanceAfter: session.ledgerBalanceAfter,
      idempotencyKey: session.idempotencyKey,
    })),
  };
}

test("a committed video disable wins the PostgreSQL completion race without reward writes", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId && fixture.sessionId);
  let blocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await withServer(async (origin) => {
      blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
        [fixture.videoId],
      );
      const blockerPid = await backendPid(blocker);

      const disable = sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId,
        "PATCH",
        { active: false },
      );
      inFlight.push(disable);
      const disablePid = await waitForBlockedBackend(
        "UPDATE daily007_v2_videos",
        [blockerPid],
      );

      const completion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(completion);
      await waitForBlockedBackend("daily007_v2_video_watch_sessions s", [
        blockerPid,
        disablePid,
      ]);

      await blocker.query("COMMIT");
      blocker.release();
      blocker = null;

      const [disabledResponse, completionResponse] = await Promise.all([disable, completion]);
      assert.ok(disablePid > 0);
      assert.equal(disabledResponse.status, 200);
      assert.equal(disabledResponse.body.active, false);
      assert.equal(completionResponse.status, 409);
      assert.equal(
        completionResponse.body.error,
        "This video is no longer available for rewards.",
      );

      const retry = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      assert.equal(retry.status, 409);
      assert.equal(retry.body.error, "This video is no longer available for rewards.");
    }, async () => {
      if (blocker) {
        await blocker.query("ROLLBACK").catch(() => undefined);
        blocker.release();
        blocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const state = await inspectFixture(fixture);
    assert.equal(state.active, false);
    assert.equal(state.walletCoins, 12);
    assert.equal(state.ledgerCount, 0);
    assert.equal(state.completedAt, null);
    assert.equal(state.rewardLedgerId, null);
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a completion holding the PostgreSQL video lock rewards once before video deactivation", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId && fixture.sessionId);
  let walletBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await withServer(async (origin) => {
      walletBlocker = await pool.connect();
      await walletBlocker.query("BEGIN");
      await walletBlocker.query(
        "SELECT id FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.playerId],
      );
      const walletBlockerPid = await backendPid(walletBlocker);

      const completion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(completion);
      const completionPid = await waitForBlockedBackend(
        "SELECT wallet_coins FROM daily007_v2_users",
        [walletBlockerPid],
      );

      const disable = sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId,
        "PATCH",
        { active: false },
      );
      inFlight.push(disable);
      await waitForBlockedBackend("UPDATE daily007_v2_videos", [completionPid]);

      await walletBlocker.query("COMMIT");
      walletBlocker.release();
      walletBlocker = null;

      const [completionResponse, disabledResponse] = await Promise.all([completion, disable]);
      assert.equal(completionResponse.status, 200);
      assert.equal(completionResponse.body.rewarded, true);
      assert.equal(completionResponse.body.coins, 1);
      assert.equal(completionResponse.body.walletCoins, 13);
      assert.equal(typeof completionResponse.body.transactionId, "string");
      assert.equal(disabledResponse.status, 200);
      assert.equal(disabledResponse.body.active, false);

      const retry = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      assert.equal(retry.status, 409);
      assert.equal(retry.body.error, "This video is no longer available for rewards.");
    }, async () => {
      if (walletBlocker) {
        await walletBlocker.query("ROLLBACK").catch(() => undefined);
        walletBlocker.release();
        walletBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const state = await inspectFixture(fixture);
    assert.equal(state.active, false);
    assert.equal(state.walletCoins, 13);
    assert.equal(state.ledgerCount, 1);
    assert.ok(state.completedAt);
    assert.equal(state.rewardLedgerId, state.ledgerId);
    assert.equal(state.ledgerAmount, 1);
    assert.equal(state.ledgerBalanceAfter, 13);
  } finally {
    if (walletBlocker) {
      await walletBlocker.query("ROLLBACK").catch(() => undefined);
      walletBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("two concurrent completions for one watch session credit exactly once", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.playerId && fixture.videoId && fixture.sessionId);
  let sessionBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  let winningTransactionId: string | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await withServer(async (origin) => {
      sessionBlocker = await pool.connect();
      await sessionBlocker.query("BEGIN");
      await sessionBlocker.query(
        "SELECT id FROM daily007_v2_video_watch_sessions WHERE id = $1 FOR UPDATE",
        [fixture.sessionId],
      );
      const blockerPid = await backendPid(sessionBlocker);

      const firstCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(firstCompletion);
      const firstCompletionPid = await waitForBlockedBackend(
        "daily007_v2_video_watch_sessions s",
        [blockerPid],
      );

      const secondCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(secondCompletion);
      const secondCompletionPid = await waitForBlockedBackend(
        "daily007_v2_video_watch_sessions s",
        [firstCompletionPid],
      );
      assert.notEqual(secondCompletionPid, firstCompletionPid);

      await sessionBlocker.query("COMMIT");
      sessionBlocker.release();
      sessionBlocker = null;

      const [firstResponse, secondResponse] = await Promise.all([
        firstCompletion,
        secondCompletion,
      ]);
      assert.equal(firstResponse.status, 200);
      assert.equal(firstResponse.body.rewarded, true);
      assert.equal(firstResponse.body.coins, 1);
      assert.equal(firstResponse.body.walletCoins, 13);
      assert.equal(typeof firstResponse.body.transactionId, "string");
      winningTransactionId = firstResponse.body.transactionId as string;

      assert.equal(secondResponse.status, 200);
      assert.equal(secondResponse.body.rewarded, false);
      assert.equal(secondResponse.body.coins, 0);
      assert.equal(secondResponse.body.walletCoins, 13);
      assert.equal(secondResponse.body.transactionId, winningTransactionId);
      assert.equal(secondResponse.body.message, "This view has already been rewarded.");
    }, async () => {
      if (sessionBlocker) {
        await sessionBlocker.query("ROLLBACK").catch(() => undefined);
        sessionBlocker.release();
        sessionBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const state = await inspectFixture(fixture);
    assert.equal(state.active, true);
    assert.equal(state.walletCoins, 13);
    assert.equal(state.ledgerCount, 1);
    assert.ok(state.completedAt);
    assert.equal(state.rewardLedgerId, state.ledgerId);
    assert.equal(state.rewardLedgerId, winningTransactionId);
    assert.equal(state.ledgerAmount, 1);
    assert.equal(state.ledgerBalanceAfter, 13);
  } finally {
    if (sessionBlocker) {
      await sessionBlocker.query("ROLLBACK").catch(() => undefined);
      sessionBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("two concurrent sessions for one player retain separate video rewards", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  let walletBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];

  try {
    const secondVideoResult = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_videos (title, topic, youtube_id, created_by)
       VALUES ('Second video race test', 'Concurrency', $1, $2)
       RETURNING id`,
      [randomUUID().replace(/-/g, "").slice(0, 11), fixture.adminId],
    );
    const secondVideoId = secondVideoResult.rows[0]?.id;
    assert.ok(secondVideoId, "second test video should be created");
    fixture.additionalVideoIds.push(secondVideoId);

    const createSession = async (videoId: string): Promise<string> => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO daily007_v2_video_watch_sessions
           (user_id, video_id, duration_seconds, started_at)
         VALUES ($1, $2, 5, now() - interval '30 seconds')
         RETURNING id`,
        [fixture.playerId, videoId],
      );
      const sessionId = result.rows[0]?.id;
      assert.ok(sessionId, "test watch session should be created");
      return sessionId;
    };

    const firstSessionId = await createSession(fixture.videoId);
    fixture.sessionId = firstSessionId;
    const secondSessionId = await createSession(secondVideoId);
    fixture.additionalSessionIds.push(secondSessionId);
    const sessionIds: [string, string] = [firstSessionId, secondSessionId];

    await withServer(async (origin) => {
      walletBlocker = await pool.connect();
      await walletBlocker.query("BEGIN");
      await walletBlocker.query(
        "SELECT id FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.playerId],
      );
      const walletBlockerPid = await backendPid(walletBlocker);

      const firstCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: firstSessionId, percentWatched: 100 },
      );
      inFlight.push(firstCompletion);
      const firstCompletionPid = await waitForBlockedBackend(
        "SELECT wallet_coins FROM daily007_v2_users",
        [walletBlockerPid],
      );

      const secondCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: secondSessionId, percentWatched: 100 },
      );
      inFlight.push(secondCompletion);
      const secondCompletionPid = await waitForBlockedBackend(
        "SELECT wallet_coins FROM daily007_v2_users",
        [firstCompletionPid],
      );
      assert.notEqual(secondCompletionPid, firstCompletionPid);

      await walletBlocker.query("COMMIT");
      walletBlocker.release();
      walletBlocker = null;

      const [firstResponse, secondResponse] = await Promise.all([
        firstCompletion,
        secondCompletion,
      ]);
      for (const response of [firstResponse, secondResponse]) {
        assert.equal(response.status, 200);
        assert.equal(response.body.rewarded, true);
        assert.equal(response.body.coins, 1);
        assert.ok([13, 14].includes(Number(response.body.walletCoins)));
        assert.equal(typeof response.body.transactionId, "string");
      }
      assert.deepEqual(
        [Number(firstResponse.body.walletCoins), Number(secondResponse.body.walletCoins)]
          .sort((left, right) => left - right),
        [13, 14],
      );
      assert.notEqual(firstResponse.body.transactionId, secondResponse.body.transactionId);

      const state = await inspectConcurrentSessions(fixture, sessionIds);
      assert.equal(state.walletCoins, 14, "the wallet should receive both one-coin rewards");
      assert.equal(state.rewardLedgerCount, 2, "exactly two video reward rows should exist");
      assert.equal(state.sessions.length, 2);

      const transactionIdBySession = new Map([
        [firstSessionId, firstResponse.body.transactionId],
        [secondSessionId, secondResponse.body.transactionId],
      ]);
      for (const session of state.sessions) {
        assert.ok(session.completedAt);
        assert.equal(session.videoActive, true);
        assert.ok(session.ledgerId);
        assert.equal(session.rewardLedgerId, session.ledgerId);
        assert.equal(session.ledgerAmount, 1);
        assert.ok([13, 14].includes(Number(session.ledgerBalanceAfter)));
        assert.equal(
          session.idempotencyKey,
          `daily007-video-watch:${session.sessionId}`,
        );
        assert.equal(session.ledgerId, transactionIdBySession.get(session.sessionId));
      }

      const historyResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: authHeaders(fixture.playerId),
      });
      assert.equal(historyResponse.status, 200);
      const history = await historyResponse.json() as Array<{
        id: string;
        amount: number;
        balanceAfter: number;
        reason: string;
        description: string;
        details: Record<string, unknown> | null;
      }>;
      const videoRewards = history.filter((transaction) =>
        transaction.reason === "video_watch_reward"
      );
      assert.equal(videoRewards.length, 2, "Wallet history should include both video rewards");
      assert.equal(new Set(videoRewards.map((transaction) => transaction.id)).size, 2);
      assert.deepEqual(
        videoRewards.map((transaction) => transaction.balanceAfter).sort((left, right) => left - right),
        [13, 14],
      );

      const responseBySession = new Map([
        [firstSessionId, firstResponse],
        [secondSessionId, secondResponse],
      ]);
      const historySessionIds: string[] = [];
      for (const transaction of videoRewards) {
        assert.equal(transaction.amount, 1);
        assert.equal(transaction.description, "Video watch reward");
        const sessionId = transaction.details?.sessionId;
        assert.equal(typeof sessionId, "string");
        assert.ok(sessionId);
        historySessionIds.push(sessionId);
        const completionResponse = responseBySession.get(sessionId);
        assert.ok(completionResponse, "history should point to one of the completed sessions");
        assert.equal(transaction.id, completionResponse.body.transactionId);
        assert.equal(transaction.balanceAfter, completionResponse.body.walletCoins);
      }
      assert.deepEqual(historySessionIds.sort(), [...sessionIds].sort());
    }, async () => {
      if (walletBlocker) {
        await walletBlocker.query("ROLLBACK").catch(() => undefined);
        walletBlocker.release();
        walletBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });
  } finally {
    if (walletBlocker) {
      await walletBlocker.query("ROLLBACK").catch(() => undefined);
      walletBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a locked wallet row for one player does not block another player's video reward", async () => {
  const lockedPlayerFixture = await createFixture();
  let independentPlayerFixture: TestFixture | null = null;
  let walletBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];

  try {
    independentPlayerFixture = await createFixture();
    assert.ok(
      lockedPlayerFixture.adminId &&
        lockedPlayerFixture.playerId &&
        lockedPlayerFixture.videoId &&
        lockedPlayerFixture.sessionId,
    );
    assert.ok(
      independentPlayerFixture.adminId &&
        independentPlayerFixture.playerId &&
        independentPlayerFixture.videoId &&
        independentPlayerFixture.sessionId,
    );
    assert.notEqual(lockedPlayerFixture.playerId, independentPlayerFixture.playerId);
    assert.notEqual(lockedPlayerFixture.videoId, independentPlayerFixture.videoId);

    await withServer(async (origin) => {
      walletBlocker = await pool.connect();
      await walletBlocker.query("BEGIN");
      await walletBlocker.query(
        "SELECT id FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [lockedPlayerFixture.playerId],
      );
      const walletBlockerPid = await backendPid(walletBlocker);

      const lockedPlayerCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        lockedPlayerFixture.playerId,
        "POST",
        { sessionId: lockedPlayerFixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(lockedPlayerCompletion);
      const lockedPlayerCompletionPid = await waitForBlockedBackend(
        "SELECT wallet_coins FROM daily007_v2_users",
        [walletBlockerPid],
      );

      const independentPlayerCompletion = sendJson(
        origin,
        "/videos/watch/complete",
        independentPlayerFixture.playerId,
        "POST",
        { sessionId: independentPlayerFixture.sessionId, percentWatched: 100 },
      );
      inFlight.push(independentPlayerCompletion);

      let completionTimeout: ReturnType<typeof setTimeout> | undefined;
      const independentResponse = await Promise.race([
        independentPlayerCompletion,
        new Promise<never>((_resolve, reject) => {
          completionTimeout = setTimeout(() => {
            reject(new Error(
              "A wallet lock for one player blocked the other player's reward completion.",
            ));
          }, 5_000);
        }),
      ]).finally(() => {
        if (completionTimeout) clearTimeout(completionTimeout);
      });
      assert.equal(independentResponse.status, 200);
      assert.equal(independentResponse.body.rewarded, true);
      assert.equal(independentResponse.body.coins, 1);
      assert.equal(independentResponse.body.walletCoins, 13);
      assert.equal(typeof independentResponse.body.transactionId, "string");

      const stillBlockedPid = await waitForBlockedBackend(
        "SELECT wallet_coins FROM daily007_v2_users",
        [walletBlockerPid],
      );
      assert.equal(
        stillBlockedPid,
        lockedPlayerCompletionPid,
        "the first player's completion should still be waiting on only that player's wallet",
      );

      await walletBlocker.query("COMMIT");
      walletBlocker.release();
      walletBlocker = null;

      const lockedPlayerResponse = await lockedPlayerCompletion;
      assert.equal(lockedPlayerResponse.status, 200);
      assert.equal(lockedPlayerResponse.body.rewarded, true);
      assert.equal(lockedPlayerResponse.body.coins, 1);
      assert.equal(lockedPlayerResponse.body.walletCoins, 13);
      assert.equal(typeof lockedPlayerResponse.body.transactionId, "string");
      assert.notEqual(
        lockedPlayerResponse.body.transactionId,
        independentResponse.body.transactionId,
        "each player's session should receive a distinct ledger row",
      );

      const [lockedPlayerState, independentPlayerState] = await Promise.all([
        inspectFixture(lockedPlayerFixture),
        inspectFixture(independentPlayerFixture),
      ]);
      for (const [state, response] of [
        [lockedPlayerState, lockedPlayerResponse],
        [independentPlayerState, independentResponse],
      ] as const) {
        assert.equal(state.active, true);
        assert.equal(state.walletCoins, 13);
        assert.ok(state.completedAt);
        assert.equal(state.ledgerCount, 1, "each player should have exactly one reward ledger row");
        assert.equal(state.ledgerAmount, 1);
        assert.equal(state.ledgerBalanceAfter, 13);
        assert.ok(state.ledgerId);
        assert.equal(state.rewardLedgerId, state.ledgerId);
        assert.equal(state.rewardLedgerId, response.body.transactionId);
      }
      assert.notEqual(lockedPlayerState.ledgerId, independentPlayerState.ledgerId);
    }, async () => {
      if (walletBlocker) {
        await walletBlocker.query("ROLLBACK").catch(() => undefined);
        walletBlocker.release();
        walletBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });
  } finally {
    if (walletBlocker) {
      await walletBlocker.query("ROLLBACK").catch(() => undefined);
      walletBlocker.release();
    }
    await cleanupFixture(lockedPlayerFixture);
    if (independentPlayerFixture) await cleanupFixture(independentPlayerFixture);
  }
});

test("a failed wallet-ledger insert rolls back a video reward", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId && fixture.sessionId);
  const failureConstraint = `reject_video_reward_${randomUUID().replace(/-/g, "")}`;
  const failedLedgerKey = `daily007-video-watch:${fixture.sessionId}`;
  let constraintInstalled = false;

  try {
    await pool.query(
      `ALTER TABLE daily007_v2_wallet_ledger
       ADD CONSTRAINT ${failureConstraint}
       CHECK (
         reason <> 'video_watch_reward'
         OR idempotency_key IS DISTINCT FROM '${failedLedgerKey}'
       )`,
    );
    constraintInstalled = true;

    await withServer(async (origin) => {
      const response = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Internal server error.");
    });

    const state = await inspectFixture(fixture);
    assert.equal(state.walletCoins, 12, "a failed ledger write must not change the wallet");
    assert.equal(state.ledgerCount, 0, "the failed reward must not leave a ledger row");
    assert.equal(state.ledgerId, null);
    assert.equal(state.completedAt, null, "the failed reward must leave the session incomplete");
    assert.equal(state.rewardLedgerId, null);
  } finally {
    try {
      if (constraintInstalled) {
        await pool.query(
          `ALTER TABLE daily007_v2_wallet_ledger
           DROP CONSTRAINT IF EXISTS ${failureConstraint}`,
        );
      }
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("a failed watch-session completion update rolls back a video reward", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId && fixture.sessionId);
  const failureSuffix = randomUUID().replace(/-/g, "");
  const failureTrigger = `fail_video_completion_${failureSuffix}`;
  const failureFunction = `fail_video_completion_function_${failureSuffix}`;
  const failureSequence = `fail_video_completion_sequence_${failureSuffix}`;
  const failedLedgerKey = `daily007-video-watch:${fixture.sessionId}`;

  try {
    await pool.query(`CREATE SEQUENCE ${failureSequence}`);
    await pool.query(`
      CREATE FUNCTION ${failureFunction}() RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF OLD.completed_at IS NULL
           AND NEW.completed_at IS NOT NULL
           AND OLD.reward_ledger_id IS NULL
           AND NEW.reward_ledger_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM daily007_v2_wallet_ledger
              WHERE id = NEW.reward_ledger_id
                AND idempotency_key = '${failedLedgerKey}'
                AND reason = 'video_watch_reward'
           ) THEN
          PERFORM nextval('${failureSequence}');
          RAISE EXCEPTION 'injected video watch completion update failure';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
    await pool.query(`
      CREATE TRIGGER ${failureTrigger}
      BEFORE UPDATE OF completed_at, reward_ledger_id
      ON daily007_v2_video_watch_sessions
      FOR EACH ROW
      WHEN (OLD.id = '${fixture.sessionId}'::uuid)
      EXECUTE FUNCTION ${failureFunction}()
    `);

    await withServer(async (origin) => {
      const response = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Internal server error.");
    });

    const failureEvidence = await pool.query<{ lastValue: string; isCalled: boolean }>(
      `SELECT last_value::text AS "lastValue", is_called AS "isCalled"
         FROM ${failureSequence}`,
    );
    assert.equal(failureEvidence.rows[0]?.lastValue, "1");
    assert.equal(
      failureEvidence.rows[0]?.isCalled,
      true,
      "the completion failure should run only after its matching ledger insert",
    );

    const state = await inspectFixture(fixture);
    assert.equal(state.walletCoins, 12, "a failed completion update must not change the wallet");
    assert.equal(state.ledgerCount, 0, "the failed reward must not leave a ledger row");
    assert.equal(state.ledgerId, null);
    assert.equal(state.completedAt, null, "the failed reward must leave the session incomplete");
    assert.equal(state.rewardLedgerId, null);
  } finally {
    try {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${failureTrigger} ON daily007_v2_video_watch_sessions`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS ${failureFunction}()`);
      await pool.query(`DROP SEQUENCE IF EXISTS ${failureSequence}`);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("overlapping retries create one watch session and reward", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.playerId && fixture.videoId);
  const attemptId = randomUUID();
  const gateSuffix = randomUUID().replace(/-/g, "");
  const gateSequence = `video_start_gate_seq_${gateSuffix}`;
  const gateFunction = `video_start_gate_fn_${gateSuffix}`;
  const gateTrigger = `video_start_gate_trg_${gateSuffix}`;
  let startGate: Awaited<ReturnType<typeof pool.connect>> | null = null;
  let winningTransactionId: string | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await pool.query(`CREATE SEQUENCE ${gateSequence}`);
    await pool.query(
      `CREATE FUNCTION ${gateFunction}() RETURNS trigger
       LANGUAGE plpgsql
       AS $$
       BEGIN
         IF NEW.start_attempt_id = '${attemptId}' THEN
           IF nextval('${gateSequence}') = 1 THEN
             PERFORM pg_advisory_xact_lock(hashtextextended(NEW.start_attempt_id, 0));
           END IF;
         END IF;
         RETURN NEW;
       END;
       $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${gateTrigger}
       BEFORE INSERT ON daily007_v2_video_watch_sessions
       FOR EACH ROW EXECUTE FUNCTION ${gateFunction}()`,
    );

    startGate = await pool.connect();
    await startGate.query("BEGIN");
    await startGate.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [attemptId],
    );
    const gatePid = await backendPid(startGate);

    await withServer(async (origin) => {
      const firstStart = sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId },
      );
      inFlight.push(firstStart);
      await waitForBlockedBackend(
        "INSERT INTO daily007_v2_video_watch_sessions",
        [gatePid],
      );

      const secondStart = sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId },
      );
      inFlight.push(secondStart);
      const secondResponse = await secondStart;
      assert.equal(secondResponse.status, 201, "one overlapping start should create the session");
      assert.equal(typeof secondResponse.body.sessionId, "string");

      await startGate!.query("COMMIT");
      startGate!.release();
      startGate = null;

      const firstResponse = await firstStart;
      assert.equal(firstResponse.status, 200, "the blocked retry should reuse the session");
      assert.equal(firstResponse.body.sessionId, secondResponse.body.sessionId);
      assert.equal(firstResponse.body.startedAt, secondResponse.body.startedAt);
      fixture.sessionId = secondResponse.body.sessionId as string;

      const sessions = await pool.query<{
        id: string;
        video_id: string;
        duration_seconds: number;
      }>(
        `SELECT id, video_id, duration_seconds
           FROM daily007_v2_video_watch_sessions
          WHERE user_id = $1 AND start_attempt_id = $2`,
        [fixture.playerId, attemptId],
      );
      assert.equal(sessions.rows.length, 1, "one session should exist for the player and attempt");
      assert.equal(sessions.rows[0]?.id, fixture.sessionId);
      assert.equal(sessions.rows[0]?.video_id, fixture.videoId);
      assert.equal(sessions.rows[0]?.duration_seconds, 30);

      await pool.query(
        `UPDATE daily007_v2_video_watch_sessions
            SET started_at = now() - interval '30 seconds'
          WHERE id = $1`,
        [fixture.sessionId],
      );
      const firstCompletion = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId!,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      const repeatedCompletion = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId!,
        "POST",
        { sessionId: fixture.sessionId, percentWatched: 100 },
      );
      assert.equal(firstCompletion.status, 200);
      assert.equal(firstCompletion.body.rewarded, true);
      assert.equal(firstCompletion.body.coins, 1);
      assert.equal(typeof firstCompletion.body.transactionId, "string");
      winningTransactionId = firstCompletion.body.transactionId as string;
      assert.equal(repeatedCompletion.status, 200);
      assert.equal(repeatedCompletion.body.rewarded, false);
      assert.equal(repeatedCompletion.body.coins, 0);
      assert.equal(repeatedCompletion.body.transactionId, winningTransactionId);
    }, async () => {
      if (startGate) {
        await startGate.query("ROLLBACK").catch(() => undefined);
        startGate.release();
        startGate = null;
      }
      await Promise.allSettled(inFlight);
    });

    const state = await inspectFixture(fixture);
    assert.equal(state.walletCoins, 13);
    assert.equal(state.ledgerCount, 1, "repeated completion should leave one reward ledger entry");
    assert.ok(state.completedAt);
    assert.equal(state.rewardLedgerId, state.ledgerId);
    assert.equal(state.rewardLedgerId, winningTransactionId);
  } finally {
    if (startGate) {
      await startGate.query("ROLLBACK").catch(() => undefined);
      startGate.release();
    }
    await Promise.allSettled(inFlight);
    try {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${gateTrigger} ON daily007_v2_video_watch_sessions`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS ${gateFunction}()`);
      await pool.query(`DROP SEQUENCE IF EXISTS ${gateSequence}`);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("repeating a watch start reuses its session while a new playback attempt earns a separate reward", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  const attemptId = randomUUID();
  const replayAttemptId = randomUUID();
  try {
    await withServer(async (origin) => {
      const firstStart = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId },
      );
      assert.equal(firstStart.status, 201);
      assert.equal(typeof firstStart.body.sessionId, "string");
      const firstSessionId = firstStart.body.sessionId as string;
      fixture.sessionId = firstSessionId;

      const retryStart = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId },
      );
      assert.equal(retryStart.status, 200);
      assert.equal(retryStart.body.sessionId, firstSessionId);
      assert.equal(retryStart.body.startedAt, firstStart.body.startedAt);

      const mismatchedRetry = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 31, attemptId },
      );
      assert.equal(mismatchedRetry.status, 409);

      const disableVideo = await sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId!,
        "PATCH",
        { active: false },
      );
      assert.equal(disableVideo.status, 200);
      const retryAfterDisable = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId },
      );
      assert.equal(retryAfterDisable.status, 200);
      assert.equal(retryAfterDisable.body.sessionId, firstSessionId);
      const newAttemptWhileDisabled = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId: randomUUID() },
      );
      assert.equal(newAttemptWhileDisabled.status, 404);
      const reactivateVideo = await sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId!,
        "PATCH",
        { active: true },
      );
      assert.equal(reactivateVideo.status, 200);

      const afterRetry = await listFixtureWatchSessions(fixture);
      assert.equal(afterRetry.length, 1, "a repeated attempt must not insert a second session");
      assert.equal(afterRetry[0]?.startAttemptId, attemptId);

      const replayStart = await sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId!,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId: replayAttemptId },
      );
      assert.equal(replayStart.status, 201);
      assert.equal(typeof replayStart.body.sessionId, "string");
      const replaySessionId = replayStart.body.sessionId as string;
      assert.notEqual(replaySessionId, firstSessionId);
      fixture.additionalSessionIds.push(replaySessionId);

      const sessions = await listFixtureWatchSessions(fixture);
      assert.equal(sessions.length, 2, "a deliberate replay should create a new session");
      assert.deepEqual(
        new Set(sessions.map((session) => session.startAttemptId)),
        new Set([attemptId, replayAttemptId]),
      );

      const backdated = await pool.query(
        `UPDATE daily007_v2_video_watch_sessions
            SET started_at = now() - interval '30 seconds'
          WHERE id = ANY($1::uuid[])`,
        [[firstSessionId, replaySessionId]],
      );
      assert.equal(backdated.rowCount, 2);

      const firstCompletion = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId!,
        "POST",
        { sessionId: firstSessionId, percentWatched: 100 },
      );
      const replayCompletion = await sendJson(
        origin,
        "/videos/watch/complete",
        fixture.playerId!,
        "POST",
        { sessionId: replaySessionId, percentWatched: 100 },
      );
      assert.equal(firstCompletion.status, 200);
      assert.equal(replayCompletion.status, 200);

      const state = await inspectConcurrentSessions(fixture, [firstSessionId, replaySessionId]);
      assert.equal(state.walletCoins, 14);
      assert.equal(state.rewardLedgerCount, 2);
      assert.deepEqual(
        new Set(state.sessions.map((session) => session.sessionId)),
        new Set([firstSessionId, replaySessionId]),
      );
      for (const session of state.sessions) {
        assert.equal(session.rewardLedgerId, session.ledgerId);
        assert.equal(session.ledgerAmount, 1);
        assert.equal(session.idempotencyKey, `daily007-video-watch:${session.sessionId}`);
        assert.ok(session.completedAt);
      }
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a committed video disable wins the PostgreSQL watch-start race without creating a session", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  let videoBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await withServer(async (origin) => {
      videoBlocker = await pool.connect();
      await videoBlocker.query("BEGIN");
      await videoBlocker.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
        [fixture.videoId],
      );
      const blockerPid = await backendPid(videoBlocker);

      const disable = sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId,
        "PATCH",
        { active: false },
      );
      inFlight.push(disable);
      const disablePid = await waitForBlockedBackend(
        "UPDATE daily007_v2_videos",
        [blockerPid],
      );

      const start = sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId: randomUUID() },
      );
      inFlight.push(start);
      const startPid = await waitForBlockedBackend(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 AND active = true",
        [disablePid],
      );
      assert.notEqual(startPid, disablePid);

      await videoBlocker.query("COMMIT");
      videoBlocker.release();
      videoBlocker = null;

      const [disabledResponse, startResponse] = await Promise.all([disable, start]);
      if (typeof startResponse.body.sessionId === "string") {
        fixture.sessionId = startResponse.body.sessionId;
      }
      assert.equal(disabledResponse.status, 200);
      assert.equal(disabledResponse.body.active, false);
      assert.equal(startResponse.status, 404);
      assert.equal(startResponse.body.error, "This video is unavailable.");
    }, async () => {
      if (videoBlocker) {
        await videoBlocker.query("ROLLBACK").catch(() => undefined);
        videoBlocker.release();
        videoBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const sessions = await listFixtureWatchSessions(fixture);
    assert.equal(sessions.length, 0, "a disabled video must not create a watch session");
  } finally {
    if (videoBlocker) {
      await videoBlocker.query("ROLLBACK").catch(() => undefined);
      videoBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a committed watch start wins the PostgreSQL video-disable race before deactivation", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  let videoBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<JsonResponse>[] = [];
  try {
    await withServer(async (origin) => {
      videoBlocker = await pool.connect();
      await videoBlocker.query("BEGIN");
      await videoBlocker.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
        [fixture.videoId],
      );
      const blockerPid = await backendPid(videoBlocker);

      const start = sendJson(
        origin,
        "/videos/watch/start",
        fixture.playerId,
        "POST",
        { videoId: fixture.videoId, durationSeconds: 30, attemptId: randomUUID() },
      );
      inFlight.push(start);
      const startPid = await waitForBlockedBackend(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 AND active = true",
        [blockerPid],
      );

      const disable = sendJson(
        origin,
        `/admin/videos/${fixture.videoId}/active`,
        fixture.adminId,
        "PATCH",
        { active: false },
      );
      inFlight.push(disable);
      const disablePid = await waitForBlockedBackend(
        "UPDATE daily007_v2_videos",
        [startPid],
      );
      assert.notEqual(disablePid, startPid);

      await videoBlocker.query("COMMIT");
      videoBlocker.release();
      videoBlocker = null;

      const [startResponse, disabledResponse] = await Promise.all([start, disable]);
      assert.equal(startResponse.status, 201);
      assert.equal(typeof startResponse.body.sessionId, "string");
      assert.equal(typeof startResponse.body.startedAt, "string");
      fixture.sessionId = startResponse.body.sessionId as string;
      assert.ok(Number.isFinite(Date.parse(startResponse.body.startedAt as string)));
      assert.equal(disabledResponse.status, 200);
      assert.equal(disabledResponse.body.active, false);
    }, async () => {
      if (videoBlocker) {
        await videoBlocker.query("ROLLBACK").catch(() => undefined);
        videoBlocker.release();
        videoBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const sessions = await listFixtureWatchSessions(fixture);
    assert.equal(sessions.length, 1, "a start committed first should create exactly one session");
    assert.equal(sessions[0]?.id, fixture.sessionId);
    assert.equal(sessions[0]?.durationSeconds, 30);
    assert.ok(sessions[0]?.startedAt);
    assert.equal(sessions[0]?.completedAt, null);
    assert.equal(sessions[0]?.rewardLedgerId, null);
    assert.equal(sessions[0]?.videoActive, false);
  } finally {
    if (videoBlocker) {
      await videoBlocker.query("ROLLBACK").catch(() => undefined);
      videoBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a committed watch start keeps its video when permanent deletion races in PostgreSQL", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  const adminId = fixture.adminId;
  const playerId = fixture.playerId;
  const videoId = fixture.videoId;
  const unrelatedBefore = await snapshotUnrelatedVideoState(videoId);
  let videoBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  const inFlight: Promise<unknown>[] = [];
  try {
    await withServer(async (origin) => {
      videoBlocker = await pool.connect();
      await videoBlocker.query("BEGIN");
      await videoBlocker.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
        [videoId],
      );
      const blockerPid = await backendPid(videoBlocker);

      const start = sendJson(
        origin,
        "/videos/watch/start",
        playerId,
        "POST",
        { videoId, durationSeconds: 30, attemptId: randomUUID() },
      );
      inFlight.push(start);
      const startPid = await waitForBlockedBackend(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 AND active = true FOR SHARE",
        [blockerPid],
      );

      const deletion = sendPermanentDelete(origin, videoId, adminId);
      inFlight.push(deletion);
      const deletePid = await waitForBlockedBackend(
        "FROM daily007_v2_videos",
        [startPid],
      );
      assert.notEqual(deletePid, startPid);

      await videoBlocker.query("COMMIT");
      videoBlocker.release();
      videoBlocker = null;

      const [startResponse, deleteResponse] = await Promise.all([start, deletion]);
      assert.equal(startResponse.status, 201);
      assert.equal(typeof startResponse.body.sessionId, "string");
      const sessionId = startResponse.body.sessionId as string;
      fixture.sessionId = sessionId;
      assert.equal(deleteResponse.status, 409);
      assert.equal(
        deleteResponse.body.error,
        "This video has watch history. Hide it instead of permanently deleting it.",
      );
    }, async () => {
      if (videoBlocker) {
        await videoBlocker.query("ROLLBACK").catch(() => undefined);
        videoBlocker.release();
        videoBlocker = null;
      }
      await Promise.allSettled(inFlight);
    });

    const [videos, sessions] = await Promise.all([
      pool.query<{ id: string }>(
        "SELECT id FROM daily007_v2_videos WHERE id = $1",
        [videoId],
      ),
      pool.query<{ id: string; user_id: string; video_id: string }>(
        `SELECT id, user_id, video_id
           FROM daily007_v2_video_watch_sessions
          WHERE video_id = $1`,
        [videoId],
      ),
    ]);
    assert.equal(videos.rows.length, 1, "the video must remain after watch history commits first");
    assert.equal(sessions.rows.length, 1, "the committed watch session must remain");
    assert.equal(sessions.rows[0]?.user_id, playerId);
    assert.equal(sessions.rows[0]?.video_id, videoId);
    assert.equal(sessions.rows[0]?.id, fixture.sessionId);
    assert.deepEqual(await snapshotUnrelatedVideoState(videoId), unrelatedBefore);
  } finally {
    if (videoBlocker) {
      await videoBlocker.query("ROLLBACK").catch(() => undefined);
      videoBlocker.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a permanent delete queued before a watch-session insert leaves no orphan", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  const adminId = fixture.adminId;
  const playerId = fixture.playerId;
  const videoId = fixture.videoId;
  const unrelatedBefore = await snapshotUnrelatedVideoState(videoId);
  let videoBlocker: Awaited<ReturnType<typeof pool.connect>> | null = null;
  let insertClient: Awaited<ReturnType<typeof pool.connect>> | null = null;
  let insertAttempt: Promise<SessionInsertOutcome> | null = null;
  const inFlight: Promise<unknown>[] = [];
  try {
    await withServer(async (origin) => {
      videoBlocker = await pool.connect();
      await videoBlocker.query("BEGIN");
      await videoBlocker.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
        [videoId],
      );
      const blockerPid = await backendPid(videoBlocker);

      const deletion = sendPermanentDelete(origin, videoId, adminId);
      inFlight.push(deletion);
      const deletePid = await waitForBlockedBackend(
        "FROM daily007_v2_videos",
        [blockerPid],
      );

      insertClient = await pool.connect();
      await insertClient.query("BEGIN");
      const insertPid = await backendPid(insertClient);
      insertAttempt = insertClient.query<{ id: string }>(
        `INSERT INTO daily007_v2_video_watch_sessions
           (user_id, video_id, duration_seconds, start_attempt_id)
         VALUES ($1, $2, 30, $3)
         RETURNING id`,
        [playerId, videoId, randomUUID()],
      ).then(
        (result) => ({
          kind: "inserted" as const,
          sessionId: result.rows[0]?.id ?? "",
        }),
        (error: unknown) => ({ kind: "failed" as const, error }),
      );
      const blockedInsertPid = await waitForBlockedBackend(
        "INSERT INTO daily007_v2_video_watch_sessions",
        [deletePid],
      );
      assert.equal(blockedInsertPid, insertPid);

      await videoBlocker.query("COMMIT");
      videoBlocker.release();
      videoBlocker = null;

      const [deleteResponse, insertOutcome] = await Promise.all([deletion, insertAttempt]);
      assert.equal(deleteResponse.status, 204);
      assert.deepEqual(deleteResponse.body, {});
      if (insertOutcome.kind !== "failed") {
        assert.fail("the watch-session insert should fail after the video deletion commits");
      }
      assert.equal(
        (insertOutcome.error as { code?: string }).code,
        "23503",
        "the session's video foreign key should reject an insert after deletion",
      );

      await insertClient.query("ROLLBACK");
      insertClient.release();
      insertClient = null;
    }, async () => {
      if (videoBlocker) {
        await videoBlocker.query("ROLLBACK").catch(() => undefined);
        videoBlocker.release();
        videoBlocker = null;
      }
      await Promise.allSettled([
        ...inFlight,
        ...(insertAttempt ? [insertAttempt] : []),
      ]);
      if (insertClient) {
        await insertClient.query("ROLLBACK").catch(() => undefined);
        insertClient.release();
        insertClient = null;
      }
    });

    const [videos, sessions] = await Promise.all([
      pool.query(
        "SELECT id FROM daily007_v2_videos WHERE id = $1",
        [videoId],
      ),
      pool.query(
        "SELECT id FROM daily007_v2_video_watch_sessions WHERE video_id = $1",
        [videoId],
      ),
    ]);
    assert.equal(videos.rows.length, 0, "the committed deletion should remove the video");
    assert.equal(sessions.rows.length, 0, "a failed insert must not leave an orphan session");
    assert.deepEqual(await snapshotUnrelatedVideoState(videoId), unrelatedBefore);
  } finally {
    if (videoBlocker) {
      await videoBlocker.query("ROLLBACK").catch(() => undefined);
      videoBlocker.release();
    }
    if (insertClient) {
      await insertClient.query("ROLLBACK").catch(() => undefined);
      insertClient.release();
    }
    await cleanupFixture(fixture);
  }
});

test("a catalog-setting failure after permanent deletion rolls back video and history state", async () => {
  const fixture = await createFixture({ includeInitialSession: false });
  assert.ok(fixture.adminId && fixture.playerId && fixture.videoId);
  const adminId = fixture.adminId;
  const playerId = fixture.playerId;
  const videoId = fixture.videoId;
  const failureConstraint = `video_seed_failure_${randomUUID().replace(/-/g, "")}`;
  let settingsCaptured = false;
  let hadSettingsBeforeTest = false;
  let originalSettings: Record<string, unknown> | null = null;
  let failureConstraintCreated = false;

  try {
    const previousSettings = await pool.query<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM daily007_v2_settings WHERE id = 1",
    );
    hadSettingsBeforeTest = previousSettings.rows.length > 0;
    originalSettings = previousSettings.rows[0]?.settings ?? null;
    settingsCaptured = true;

    const unrelatedVideoResult = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_videos (title, topic, youtube_id, created_by)
       VALUES ('Unrelated video', 'Other topic', $1, $2)
       RETURNING id`,
      [randomUUID().replace(/-/g, "").slice(0, 11), adminId],
    );
    const unrelatedVideoId = unrelatedVideoResult.rows[0]?.id;
    assert.ok(unrelatedVideoId, "the unrelated video should be created");
    fixture.additionalVideoIds.push(unrelatedVideoId);

    const unrelatedSessionResult = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_video_watch_sessions
         (user_id, video_id, duration_seconds, start_attempt_id)
       VALUES ($1, $2, 30, $3)
       RETURNING id`,
      [playerId, unrelatedVideoId, randomUUID()],
    );
    const unrelatedSessionId = unrelatedSessionResult.rows[0]?.id;
    assert.ok(unrelatedSessionId, "the unrelated watch session should be created");
    fixture.additionalSessionIds.push(unrelatedSessionId);

    const settingsBeforeRequestValue = {
      __daily007VideoCatalogSeeded: false,
      __testVideoDeleteRollback: "preserve",
    };
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`,
      [JSON.stringify(settingsBeforeRequestValue)],
    );

    const targetBefore = await pool.query(
      "SELECT * FROM daily007_v2_videos WHERE id = $1",
      [videoId],
    );
    assert.equal(targetBefore.rows.length, 1, "the target video should exist before deletion");
    const unrelatedBefore = await snapshotUnrelatedVideoState(videoId);
    const watchSessionsBefore = await pool.query(
      "SELECT * FROM daily007_v2_video_watch_sessions ORDER BY id",
    );
    const settingsBeforeRequest = await pool.query<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM daily007_v2_settings WHERE id = 1",
    );
    assert.deepEqual(settingsBeforeRequest.rows[0]?.settings, settingsBeforeRequestValue);

    await pool.query(
      `ALTER TABLE daily007_v2_settings
         ADD CONSTRAINT ${failureConstraint}
         CHECK (settings ->> '__daily007VideoCatalogSeeded' IS DISTINCT FROM 'true')`,
    );
    failureConstraintCreated = true;

    await withServer(async (origin) => {
      const response = await sendPermanentDelete(origin, videoId, adminId);
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Internal server error.");
    });

    const [targetAfter, unrelatedAfter, watchSessionsAfter, settingsAfter] = await Promise.all([
      pool.query("SELECT * FROM daily007_v2_videos WHERE id = $1", [videoId]),
      snapshotUnrelatedVideoState(videoId),
      pool.query("SELECT * FROM daily007_v2_video_watch_sessions ORDER BY id"),
      pool.query("SELECT settings FROM daily007_v2_settings WHERE id = 1"),
    ]);
    assert.deepEqual(targetAfter.rows, targetBefore.rows, "the failed request must restore the target video");
    assert.deepEqual(unrelatedAfter, unrelatedBefore, "unrelated videos and sessions must not change");
    assert.deepEqual(
      watchSessionsAfter.rows,
      watchSessionsBefore.rows,
      "watch history must remain unchanged after the transaction rolls back",
    );
    assert.deepEqual(
      settingsAfter.rows,
      settingsBeforeRequest.rows,
      "the failed catalog marker update must not partially change settings",
    );
  } finally {
    if (failureConstraintCreated) {
      await pool.query(
        `ALTER TABLE daily007_v2_settings DROP CONSTRAINT ${failureConstraint}`,
      );
    }
    if (settingsCaptured) {
      if (hadSettingsBeforeTest) {
        await pool.query(
          "UPDATE daily007_v2_settings SET settings = $1::jsonb WHERE id = 1",
          [JSON.stringify(originalSettings ?? {})],
        );
      } else {
        await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
      }
    }
    await cleanupFixture(fixture);
  }
});

test.after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});