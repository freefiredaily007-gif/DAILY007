import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after, before } from "node:test";
import { pool } from "@workspace/db";
import daily007V2Router, { hashPassword } from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-language-preference-test-secret";
const TEST_PASSWORD = "language-preference-test-password";
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
  const credentials = await hashPassword(TEST_PASSWORD);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES
       ($1, 'Language Player One', $3, $5, $6),
       ($2, 'Language Player Two', $4, $5, $6)`,
    [
      firstPlayerId,
      secondPlayerId,
      `language-player-${firstPlayerId}@example.test`,
      `language-player-${secondPlayerId}@example.test`,
      credentials.salt,
      credentials.hash,
    ],
  );
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API server did not start.");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
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
  const preferenceUrl = `${baseUrl}/daily007/v2/preferences/language`;
  const unauthenticated = await fetch(preferenceUrl);
  assert.equal(unauthenticated.status, 401);

  async function login(email: string): Promise<{ Authorization: string }> {
    const response = await fetch(`${baseUrl}/daily007/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { token: string };
    assert.equal(typeof body.token, "string");
    return { Authorization: `Bearer ${body.token}` };
  }

  const firstEmail = `language-player-${firstPlayerId}@example.test`;
  const secondEmail = `language-player-${secondPlayerId}@example.test`;
  const firstSession = await login(firstEmail);
  const emptyPreference = await fetch(preferenceUrl, { headers: firstSession });
  assert.equal(emptyPreference.status, 200);
  assert.deepEqual(await emptyPreference.json(), { language: null });

  const saved = await fetch(preferenceUrl, {
    method: "PUT",
    headers: { ...firstSession, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "hi", expectedLanguage: null }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { language: "hi", accepted: true });

  // A new login increments the server session version, modeling a second device
  // with its own valid authenticated session for the same account.
  const secondSession = await login(firstEmail);
  const persistedPreference = await fetch(preferenceUrl, { headers: secondSession });
  assert.equal(persistedPreference.status, 200);
  assert.deepEqual(await persistedPreference.json(), { language: "hi" });

  const staleDeviceSave = await fetch(preferenceUrl, {
    method: "PUT",
    headers: { ...secondSession, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "gu", expectedLanguage: null }),
  });
  assert.equal(staleDeviceSave.status, 200);
  assert.deepEqual(await staleDeviceSave.json(), { language: "hi", accepted: false });

  const otherAccountSession = await login(secondEmail);
  const otherPlayerPreference = await fetch(preferenceUrl, { headers: otherAccountSession });
  assert.equal(otherPlayerPreference.status, 200);
  assert.deepEqual(await otherPlayerPreference.json(), { language: null });

  const unsupported = await fetch(preferenceUrl, {
    method: "PUT",
    headers: { ...secondSession, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "fr", expectedLanguage: "hi" }),
  });
  assert.equal(unsupported.status, 400);

  const changedOtherPreference = await fetch(preferenceUrl, {
    method: "PUT",
    headers: { ...otherAccountSession, "Content-Type": "application/json" },
    body: JSON.stringify({ language: "gu", expectedLanguage: null }),
  });
  assert.equal(changedOtherPreference.status, 200);
  assert.deepEqual(await changedOtherPreference.json(), { language: "gu", accepted: true });

  const confirmed = await fetch(preferenceUrl, { headers: secondSession });
  assert.deepEqual(await confirmed.json(), { language: "hi" });
});
