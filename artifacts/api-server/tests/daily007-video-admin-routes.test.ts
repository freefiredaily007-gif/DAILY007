import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  VIDEO_TEST_ADMIN_ID,
  VIDEO_TEST_PLAYER_ID,
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

const validVideo = {
  title: "Tournament Highlights",
  topic: "Battle Royale",
  url: "https://youtu.be/a1b2C3d4E5F",
};

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