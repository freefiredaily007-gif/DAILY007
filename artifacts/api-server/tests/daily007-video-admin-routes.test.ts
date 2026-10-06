import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  VIDEO_TEST_ADMIN_ID,
  VIDEO_TEST_PLAYER_ID,
  VIDEO_TEST_TOURNAMENT_ADMIN_ID,
  videoTestDb,
} from "./support/daily007-video-test-db";

const TEST_AUTH_SECRET = "daily007-video-routes-test-secret-32-characters";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

test.after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

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

async function postVideo(
  origin: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/admin/videos`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function patchVideo(
  origin: string,
  userId: string,
  videoId: string,
  body: Record<string, unknown>,
  suffix = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/admin/videos/${videoId}${suffix}`, {
    method: "PATCH",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const validVideo = {
  title: "Tournament Highlights",
  topic: "Battle Royale",
  url: "https://youtu.be/a1b2C3d4E5F",
};

function seedWatchHistory(videoId: string): void {
  videoTestDb.watchSessions.push({
    id: "53000000-0000-4000-8000-000000000001",
    user_id: VIDEO_TEST_PLAYER_ID,
    video_id: videoId,
    duration_seconds: 600,
    reported_percent: 0,
    started_at: new Date("2026-10-05T12:05:00.000Z"),
    completed_at: null,
    reward_ledger_id: null,
  });
}

test("Full Admin creates a video that appears in the public catalog with its title and topic", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201);
    assert.equal(created.body.title, validVideo.title);
    assert.equal(created.body.topic, validVideo.topic);
    assert.equal(created.body.youtubeId, "a1b2C3d4E5F");

    const catalogResponse = await fetch(`${origin}/videos`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as {
      videos: Array<{ title: string; topic: string; youtubeId: string }>;
    };
    assert.ok(catalog.videos.some((video) =>
      video.title === validVideo.title &&
      video.topic === validVideo.topic &&
      video.youtubeId === "a1b2C3d4E5F",
    ));
  });
});

test("a regular player cannot create a managed video", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const response = await postVideo(origin, VIDEO_TEST_PLAYER_ID, validVideo);
    assert.equal(response.status, 403);
    assert.equal(videoTestDb.videos.length, 0);
  });
});

test("Tournament Admin cannot create, edit, hide, or delete managed videos", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201, "Full Admin can create a managed video");
    const videoId = String(created.body.id);
    seedWatchHistory(videoId);
    const videosBefore = structuredClone(videoTestDb.videos);
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);
    const assertCatalogUnchanged = () => {
      assert.deepEqual(videoTestDb.videos, videosBefore);
      assert.deepEqual(videoTestDb.watchSessions, watchSessionsBefore);
    };

    const listedByTournamentAdmin = await fetch(`${origin}/admin/videos`, {
      headers: authHeaders(VIDEO_TEST_TOURNAMENT_ADMIN_ID),
    });
    assert.equal(listedByTournamentAdmin.status, 403);
    assertCatalogUnchanged();

    const createdByTournamentAdmin = await postVideo(
      origin,
      VIDEO_TEST_TOURNAMENT_ADMIN_ID,
      {
        ...validVideo,
        title: "Unauthorized Video",
        url: "https://youtu.be/Q7w6V5u4T3s",
      },
    );
    assert.equal(createdByTournamentAdmin.status, 403);
    assertCatalogUnchanged();

    const editedByTournamentAdmin = await patchVideo(
      origin,
      VIDEO_TEST_TOURNAMENT_ADMIN_ID,
      videoId,
      {
        title: "Unauthorized Edit",
        topic: "Clash Squad",
        url: "https://youtu.be/Z9x8Y7w6V5u",
      },
    );
    assert.equal(editedByTournamentAdmin.status, 403);
    assertCatalogUnchanged();

    const hiddenByTournamentAdmin = await patchVideo(
      origin,
      VIDEO_TEST_TOURNAMENT_ADMIN_ID,
      videoId,
      { active: false },
      "/active",
    );
    assert.equal(hiddenByTournamentAdmin.status, 403);
    assertCatalogUnchanged();

    const deletedByTournamentAdmin = await fetch(`${origin}/admin/videos/${videoId}`, {
      method: "DELETE",
      headers: authHeaders(VIDEO_TEST_TOURNAMENT_ADMIN_ID),
    });
    assert.equal(deletedByTournamentAdmin.status, 403);
    assertCatalogUnchanged();
  });
});

test("malformed YouTube links are rejected without saving a video", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const response = await postVideo(origin, VIDEO_TEST_ADMIN_ID, {
      ...validVideo,
      url: "https://youtube.example/watch?v=a1b2C3d4E5F",
    });
    assert.equal(response.status, 400);
    assert.equal(videoTestDb.videos.length, 0);
  });
});

test("a duplicate YouTube video link is rejected", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const first = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(first.status, 201);

    const duplicate = await postVideo(origin, VIDEO_TEST_ADMIN_ID, {
      ...validVideo,
      title: "A Different Title",
    });
    assert.equal(duplicate.status, 409);
    assert.equal(videoTestDb.videos.length, 1);
  });
});

test("Full Admin cannot change a video's YouTube link after watch history exists", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201);
    const videoId = String(created.body.id);
    seedWatchHistory(videoId);
    const videosBefore = structuredClone(videoTestDb.videos);
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);

    const updated = await patchVideo(origin, VIDEO_TEST_ADMIN_ID, videoId, {
      title: "Replacement Highlights",
      topic: "Clash Squad",
      url: "https://youtu.be/Z9x8Y7w6V5u",
    });

    assert.equal(updated.status, 409);
    assert.match(String(updated.body.error), /watch history/i);
    assert.deepEqual(videoTestDb.videos, videosBefore);
    assert.deepEqual(videoTestDb.watchSessions, watchSessionsBefore);
  });
});

test("Full Admin can update a watched video's title and topic while keeping its YouTube link", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201);
    const videoId = String(created.body.id);
    seedWatchHistory(videoId);
    const videosBefore = structuredClone(videoTestDb.videos);
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);

    const updated = await patchVideo(origin, VIDEO_TEST_ADMIN_ID, videoId, {
      title: "Corrected Tournament Highlights",
      topic: "Clash Squad",
      url: validVideo.url,
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.id, videoId);
    assert.equal(updated.body.title, "Corrected Tournament Highlights");
    assert.equal(updated.body.topic, "Clash Squad");
    assert.equal(updated.body.youtubeId, "a1b2C3d4E5F");
    assert.equal(updated.body.url, "https://youtu.be/a1b2C3d4E5F");
    assert.deepEqual(videoTestDb.videos, [{
      ...videosBefore[0],
      title: "Corrected Tournament Highlights",
      topic: "Clash Squad",
    }]);
    assert.deepEqual(
      videoTestDb.watchSessions,
      watchSessionsBefore,
      "editing descriptive details must not modify the watch-session record",
    );
  });
});

test("Full Admin cannot permanently delete a video with watch history", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201);
    const videoId = String(created.body.id);
    seedWatchHistory(videoId);
    const videosBefore = structuredClone(videoTestDb.videos);
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);

    const response = await fetch(`${origin}/admin/videos/${videoId}`, {
      method: "DELETE",
      headers: authHeaders(VIDEO_TEST_ADMIN_ID),
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 409);
    assert.match(String(body.error), /hide it instead/i);
    assert.deepEqual(videoTestDb.videos, videosBefore);
    assert.deepEqual(videoTestDb.watchSessions, watchSessionsBefore);
  });
});

test("Full Admin can permanently delete an unwatched video without changing other videos or watch history", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const target = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(target.status, 201);
    const targetVideoId = String(target.body.id);

    const unrelated = await postVideo(origin, VIDEO_TEST_ADMIN_ID, {
      ...validVideo,
      title: "Other Highlights",
      url: "https://youtu.be/Q7w6V5u4T3s",
    });
    assert.equal(unrelated.status, 201);
    const unrelatedVideoId = String(unrelated.body.id);
    seedWatchHistory(unrelatedVideoId);

    const unrelatedVideoBefore = structuredClone(
      videoTestDb.videos.find((video) => video.id === unrelatedVideoId),
    );
    assert.ok(unrelatedVideoBefore, "the unrelated video should exist before deletion");
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);

    const response = await fetch(`${origin}/admin/videos/${targetVideoId}`, {
      method: "DELETE",
      headers: authHeaders(VIDEO_TEST_ADMIN_ID),
    });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.deepEqual(videoTestDb.videos, [unrelatedVideoBefore]);
    assert.deepEqual(videoTestDb.watchSessions, watchSessionsBefore);

    const catalogResponse = await fetch(`${origin}/videos`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as {
      videos: Array<{ id: string }>;
    };
    assert.deepEqual(catalog.videos.map((video) => video.id), [unrelatedVideoId]);
  });
});

test("Full Admin can hide a video without detaching its watch history", async () => {
  videoTestDb.reset();

  await withServer(async (origin) => {
    const created = await postVideo(origin, VIDEO_TEST_ADMIN_ID, validVideo);
    assert.equal(created.status, 201);
    const videoId = String(created.body.id);
    seedWatchHistory(videoId);
    const watchSessionsBefore = structuredClone(videoTestDb.watchSessions);

    const hidden = await patchVideo(
      origin,
      VIDEO_TEST_ADMIN_ID,
      videoId,
      { active: false },
      "/active",
    );
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.active, false);
    assert.equal(videoTestDb.videos.length, 1);
    assert.equal(videoTestDb.videos[0].id, videoId);
    assert.equal(videoTestDb.videos[0].active, false);
    assert.deepEqual(videoTestDb.watchSessions, watchSessionsBefore);

    const catalogResponse = await fetch(`${origin}/videos`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as { videos: unknown[] };
    assert.equal(catalog.videos.length, 0);
  });
});
