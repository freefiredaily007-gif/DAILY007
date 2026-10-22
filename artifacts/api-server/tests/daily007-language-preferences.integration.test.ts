import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after, before } from "node:test";
import { pool } from "@workspace/db";
import daily007V2Router, { makeToken } from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-language-preference-test-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

const firstPlayerId = randomUUID();
const secondPlayerId = randomUUID();
const app = express();
app.use(express.json());
app.use("/api", daily007V2Router);
let server: Server;
let baseUrl = "";

before(async () => {
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES
       ($1, 'Language Player One', $3, 'salt', 'hash'),
       ($2, 'Language Player Two', $4, 'salt', 'hash')`,
    [
      firstPlayerId,
      secondPlayerId,
      `language-player-${firstPlayerId}@example.test`,
      `language-player-${secondPlayerId}@example.test`,
    ],
  );
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API server did not start.");
  baseUrl = `http://127.0.0.1:${address.port}/api/daily007/v2/preferences/language`;
});

after(async () => {
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
      [firstPlayerId, secondPlayerId],
    ]);
  } finally {
    await pool.end();
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  }
});

test("language preference is authenticated, validated, and isolated by player", async () => {
  const unauthenticated = await fetch(baseUrl);
  assert.equal(unauthenticated.status, 401);

  const firstToken = makeToken(firstPlayerId);
  const secondToken = makeToken(secondPlayerId);
  assert.ok(firstToken);
  assert.ok(secondToken);
  const firstHeaders = { Authorization: `Bearer ${firstToken}` };
  const secondHeaders = { Authorization: `Bearer ${secondToken}` };

  const emptyPreference = await fetch(baseUrl, { headers: firstHeaders });
  assert.equal(emptyPreference.status, 200);
  assert.deepEqual(await emptyPreference.json(), { language: null });

  const saved = await fetch(baseUrl, {
    method: "PUT",
    headers: { ...firstHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "hi" }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { language: "hi" });

  const otherPlayerPreference = await fetch(baseUrl, { headers: secondHeaders });
  assert.equal(otherPlayerPreference.status, 200);
  assert.deepEqual(await otherPlayerPreference.json(), { language: null });

  const unsupported = await fetch(baseUrl, {
    method: "PUT",
    headers: { ...firstHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "fr" }),
  });
  assert.equal(unsupported.status, 400);

  const confirmed = await fetch(baseUrl, { headers: firstHeaders });
  assert.deepEqual(await confirmed.json(), { language: "hi" });
});
