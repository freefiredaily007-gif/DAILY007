import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "daily007-video-metadata-postgres-test-secret";
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

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
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

test("corrected video metadata stays public and preserves its PostgreSQL watch session", async () => {
  const suffix = randomUUID();
  let adminId: string | null = null;
  let playerId: string | null = null;
  let videoId: string | null = null;
  let sessionId: string | null = null;

  try {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_users (name, email, password_salt, password_hash, role)
       VALUES ('Video metadata test admin', $1, 'test-salt', 'test-hash', 'admin')
       RETURNING id`,
      [`video-metadata-admin-${suffix}@example.test`],
    );
    adminId = admin.rows[0]?.id ?? null;
    assert.ok(adminId, "test admin should be created");

    const player = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_users (name, email, password_salt, password_hash)
       VALUES ('Video metadata test player', $1, 'test-salt', 'test-hash')
       RETURNING id`,
      [`video-metadata-player-${suffix}@example.test`],
    );
    playerId = player.rows[0]?.id ?? null;
    assert.ok(playerId, "test player should be created");

    const youtubeId = suffix.replace(/-/g, "").slice(0, 11);
    await withServer(async (origin) => {
      const createdResponse = await fetch(`${origin}/admin/videos`, {
        method: "POST",
        headers: authHeaders(adminId!),
        body: JSON.stringify({
          title: "Original tournament highlights",
          topic: "Battle Royale",
          url: `https://youtu.be/${youtubeId}`,
        }),
      });
      assert.equal(createdResponse.status, 201);
      const created = await createdResponse.json() as { id: string; youtubeId: string };
      videoId = created.id;
      assert.equal(created.youtubeId, youtubeId);

      const session = await pool.query<{ id: string }>(
        `INSERT INTO daily007_v2_video_watch_sessions
           (user_id, video_id, duration_seconds, reported_percent, started_at)
         VALUES ($1, $2, 75, 42, '2026-10-14T12:34:56.000Z')
         RETURNING id`,
        [playerId, videoId],
      );
      sessionId = session.rows[0]?.id ?? null;
      assert.ok(sessionId, "test watch session should be created");
      const watchSessionBefore = await pool.query(
        "SELECT * FROM daily007_v2_video_watch_sessions WHERE id = $1",
        [sessionId],
      );
      assert.equal(watchSessionBefore.rows.length, 1);

      const updatedResponse = await fetch(`${origin}/admin/videos/${videoId}`, {
        method: "PATCH",
        headers: authHeaders(adminId!),
        body: JSON.stringify({
          title: "Corrected tournament highlights",
          topic: "Clash Squad",
          url: `https://youtu.be/${youtubeId}`,
        }),
      });
      assert.equal(updatedResponse.status, 200);
      const updated = await updatedResponse.json() as {
        id: string;
        title: string;
        topic: string;
        youtubeId: string;
      };
      assert.equal(updated.id, videoId);
      assert.equal(updated.title, "Corrected tournament highlights");
      assert.equal(updated.topic, "Clash Squad");
      assert.equal(updated.youtubeId, youtubeId);

      const catalogResponse = await fetch(`${origin}/videos`);
      assert.equal(catalogResponse.status, 200);
      const catalog = await catalogResponse.json() as {
        videos: Array<{ id: string; title: string; topic: string; youtubeId: string }>;
      };
      const catalogVideo = catalog.videos.find((video) => video.id === videoId);
      assert.ok(catalogVideo, "the watched video should remain visible in the public catalog");
      assert.equal(catalogVideo.title, "Corrected tournament highlights");
      assert.equal(catalogVideo.topic, "Clash Squad");
      assert.equal(catalogVideo.youtubeId, youtubeId);

      const [storedVideo, watchSessionAfter] = await Promise.all([
        pool.query<{ title: string; topic: string; youtube_id: string }>(
          "SELECT title, topic, youtube_id FROM daily007_v2_videos WHERE id = $1",
          [videoId],
        ),
        pool.query(
          "SELECT * FROM daily007_v2_video_watch_sessions WHERE id = $1",
          [sessionId],
        ),
      ]);
      assert.deepEqual(storedVideo.rows, [{
        title: "Corrected tournament highlights",
        topic: "Clash Squad",
        youtube_id: youtubeId,
      }]);
      assert.deepEqual(
        watchSessionAfter.rows,
        watchSessionBefore.rows,
        "changing video details must not alter or detach the stored watch-session record",
      );
    });
  } finally {
    if (sessionId) {
      await pool.query("DELETE FROM daily007_v2_video_watch_sessions WHERE id = $1", [sessionId]);
    }
    if (videoId) await pool.query("DELETE FROM daily007_v2_videos WHERE id = $1", [videoId]);
    if (playerId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [playerId]);
    if (adminId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});

test.after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});
