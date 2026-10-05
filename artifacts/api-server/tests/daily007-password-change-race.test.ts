import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router, { hashPassword } from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  PASSWORD_CHANGE_TEST_USER_ID,
  passwordChangeTestDb,
} from "./support/daily007-password-change-test-db";

const TEST_AUTH_SECRET = "password-change-race-tests-only-secret-at-least-32-characters";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  passwordChangeTestDb.reset();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);

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

async function request(
  origin: string,
  path: string,
  method: "GET" | "PATCH",
  body?: Record<string, unknown>,
  token?: string,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("concurrent password changes use the original credentials for exactly one update", async () => {
  passwordChangeTestDb.reset();
  const originalPassword = "current-password-for-race-test";
  const originalCredentials = await hashPassword(originalPassword);
  passwordChangeTestDb.setCredentials({
    password_salt: originalCredentials.salt,
    password_hash: originalCredentials.hash,
  });
  const before = passwordChangeTestDb.snapshot();
  passwordChangeTestDb.holdCredentialReadsUntil(2);
  const token = makeToken(PASSWORD_CHANGE_TEST_USER_ID, before.auth_version);
  assert.ok(token);

  await withServer(async (origin) => {
    const requests = [
      request(origin, "/auth/me/password", "PATCH", {
        currentPassword: originalPassword,
        newPassword: "replacement-password-alpha",
      }, token),
      request(origin, "/auth/me/password", "PATCH", {
        currentPassword: originalPassword,
        newPassword: "replacement-password-bravo",
      }, token),
    ];

    const results = await Promise.all(requests);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal(passwordChangeTestDb.credentialReadBarrierTimedOut, false);
    const conflict = results.find((result) => result.status === 409);
    assert.equal(
      conflict?.body.error,
      "The password changed in another session. Sign in again and retry.",
    );

    assert.equal(passwordChangeTestDb.credentialReadSnapshots.length, 2);
    assert.deepEqual(passwordChangeTestDb.credentialReadSnapshots, [
      { password_salt: before.password_salt, password_hash: before.password_hash },
      { password_salt: before.password_salt, password_hash: before.password_hash },
    ], "both authenticated requests must read the same original credential pair");
    assert.equal(passwordChangeTestDb.passwordWriteAttempts, 2);
    assert.equal(passwordChangeTestDb.successfulPasswordWrites, 1);

    const after = passwordChangeTestDb.snapshot();
    assert.notEqual(after.password_salt, before.password_salt);
    assert.notEqual(after.password_hash, before.password_hash);
    assert.equal(after.auth_version, before.auth_version, "password changes must not replace sessions");
    assert.equal(after.name, before.name);
    assert.equal(after.email, before.email);
    assert.equal(after.role, before.role);
    assert.equal(after.wallet_coins, before.wallet_coins);
    assert.equal(after.phone, before.phone);
    assert.equal(after.game_uid, before.game_uid);
    assert.equal(after.status, before.status);

    const matchingReplacementPasswords = await Promise.all([
      hashPassword("replacement-password-alpha", Buffer.from(after.password_salt, "hex")),
      hashPassword("replacement-password-bravo", Buffer.from(after.password_salt, "hex")),
    ]);
    assert.equal(
      matchingReplacementPasswords.filter(({ hash }) => hash === after.password_hash).length,
      1,
      "the stored hash must match exactly one of the two proposed replacement passwords",
    );

    const existingSession = await request(origin, "/auth/me", "GET", undefined, token);
    assert.equal(existingSession.status, 200, "the pre-existing session must remain valid");
    assert.equal(existingSession.body.id, PASSWORD_CHANGE_TEST_USER_ID);
  });
});