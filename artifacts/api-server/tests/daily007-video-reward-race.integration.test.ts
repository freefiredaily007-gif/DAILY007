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

type TestFixture = {
  adminId: string | null;
  playerId: string | null;
  videoId: string | null;
  sessionId: string | null;
};

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

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

async function createFixture(
  options: { includeInitialSession?: boolean } = {},
): Promise<TestFixture> {
  const fixture: TestFixture = { adminId: null, playerId: null, videoId: null, sessionId: null };
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
    if (fixture.playerId && fixture.videoId) {
      const sessions = await client.query<{ id: string }>(
        `SELECT id FROM daily007_v2_video_watch_sessions
          WHERE user_id = $1 AND video_id = $2`,
        [fixture.playerId, fixture.videoId],
      );
      const sessionIds = new Set(sessions.rows.map((session) => session.id));
      if (fixture.sessionId) sessionIds.add(fixture.sessionId);
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
    if (fixture.videoId) {
      await client.query("DELETE FROM daily007_v2_videos WHERE id = $1", [fixture.videoId]);
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
  startedAt: Date | string;
  completedAt: Date | string | null;
  rewardLedgerId: string | null;
  videoActive: boolean;
}>> {
  assert.ok(fixture.playerId && fixture.videoId);
  const result = await pool.query<{
    id: string;
    durationSeconds: number;
    startedAt: Date | string;
    completedAt: Date | string | null;
    rewardLedgerId: string | null;
    videoActive: boolean;
  }>(
    `SELECT session.id,
            session.duration_seconds AS "durationSeconds",
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
        { videoId: fixture.videoId, durationSeconds: 30 },
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
        { videoId: fixture.videoId, durationSeconds: 30 },
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

test.after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});