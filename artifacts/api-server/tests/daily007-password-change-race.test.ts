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

type JsonResult = { status: number; body: any; retryAfter: string | null };

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
  return {
    status: response.status,
    body: await response.json(),
    retryAfter: response.headers.get("retry-after"),
  };
}

test("an overlong current password is rejected before password credential reads or writes", async () => {
  passwordChangeTestDb.reset();
  const before = passwordChangeTestDb.snapshot();
  const token = makeToken(PASSWORD_CHANGE_TEST_USER_ID, before.auth_version);
  assert.ok(token);

  await withServer(async (origin) => {
    const result = await request(origin, "/auth/me/password", "PATCH", {
      currentPassword: "x".repeat(201),
      newPassword: "replacement-password-for-length-test",
    }, token);

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Enter your current password and a new password of 8–200 characters.",
    );
    assert.equal(
      passwordChangeTestDb.credentialReadSnapshots.length,
      0,
      "an invalid current-password length must not read password credentials",
    );
    assert.equal(passwordChangeTestDb.passwordWriteAttempts, 0);
    assert.deepEqual(passwordChangeTestDb.snapshot(), before);
  });
});

test("an incorrect current password is rejected without changing credentials or the existing session", async () => {
  passwordChangeTestDb.reset();
  const originalPassword = "current-password-for-rejected-change";
  const originalCredentials = await hashPassword(originalPassword);
  passwordChangeTestDb.setCredentials({
    password_salt: originalCredentials.salt,
    password_hash: originalCredentials.hash,
  });
  const before = passwordChangeTestDb.snapshot();
  passwordChangeTestDb.holdCredentialReadsUntil(1);
  const existingToken = makeToken(PASSWORD_CHANGE_TEST_USER_ID, before.auth_version);
  assert.ok(existingToken);

  await withServer(async (origin) => {
    const result = await request(origin, "/auth/me/password", "PATCH", {
      currentPassword: "definitely-the-wrong-current-password",
      newPassword: "replacement-password-for-rejected-attempt",
    }, existingToken);

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "Current password is incorrect.");
    assert.equal(result.body.token, undefined, "a rejected change must not issue a replacement token");
    assert.equal(passwordChangeTestDb.credentialReadBarrierTimedOut, false);
    assert.deepEqual(passwordChangeTestDb.credentialReadSnapshots, [
      { password_salt: before.password_salt, password_hash: before.password_hash },
    ], "the route should verify the stored credential pair");
    assert.equal(passwordChangeTestDb.passwordWriteAttempts, 0, "a wrong current password must not attempt a credential write");
    assert.equal(passwordChangeTestDb.successfulPasswordWrites, 0);

    const after = passwordChangeTestDb.snapshot();
    assert.equal(after.password_salt, before.password_salt);
    assert.equal(after.password_hash, before.password_hash);
    assert.equal(after.auth_version, before.auth_version);
    assert.deepEqual(after, before, "the failed attempt must leave the complete account record unchanged");

    const existingSession = await request(origin, "/auth/me", "GET", undefined, existingToken);
    assert.equal(existingSession.status, 200, "the existing token should remain valid after the rejected attempt");
    assert.equal(existingSession.body.id, PASSWORD_CHANGE_TEST_USER_ID);
    assert.deepEqual(passwordChangeTestDb.snapshot(), before);
  });
});

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

test("incorrect password checks are capped per account and recover after the 15-minute window", async () => {
  passwordChangeTestDb.reset();
  const originalPassword = "current-password-for-attempt-limit";
  const originalCredentials = await hashPassword(originalPassword);
  passwordChangeTestDb.setCredentials({
    password_salt: originalCredentials.salt,
    password_hash: originalCredentials.hash,
  });
  const before = passwordChangeTestDb.snapshot();
  const token = makeToken(PASSWORD_CHANGE_TEST_USER_ID, before.auth_version);
  assert.ok(token);

  const originalNow = Date.now;
  let now = originalNow() + 60 * 60 * 1000;
  Date.now = () => now;
  try {
    passwordChangeTestDb.holdCredentialReadsUntil(5);
    await withServer(async (origin) => {
      const wrongPasswordChange = () => request(origin, "/auth/me/password", "PATCH", {
        currentPassword: "incorrect-current-password",
        newPassword: "replacement-password-after-limit",
      }, token);

      const failures = await Promise.all(Array.from({ length: 5 }, wrongPasswordChange));
      assert.deepEqual(failures.map((result) => result.status), [401, 401, 401, 401, 401]);
      assert.equal(passwordChangeTestDb.credentialReadBarrierTimedOut, false);
      assert.equal(passwordChangeTestDb.credentialReadSnapshots.length, 5);

      const limited = await wrongPasswordChange();
      assert.equal(limited.status, 429);
      assert.match(limited.body.error, /Wait \d+ seconds before trying again\./);
      assert.ok(Number(limited.retryAfter) > 0);
      assert.ok(Number(limited.retryAfter) <= 15 * 60);
      assert.equal(passwordChangeTestDb.credentialReadSnapshots.length, 5, "a limited request must not verify another guess");
      assert.equal(passwordChangeTestDb.passwordWriteAttempts, 0);

      const afterLimit = passwordChangeTestDb.snapshot();
      assert.equal(afterLimit.password_salt, before.password_salt);
      assert.equal(afterLimit.password_hash, before.password_hash);
      assert.equal(afterLimit.auth_version, before.auth_version);

      const existingSession = await request(origin, "/auth/me", "GET", undefined, token);
      assert.equal(existingSession.status, 200, "rate limiting must not invalidate the existing token");
      assert.equal(existingSession.body.id, PASSWORD_CHANGE_TEST_USER_ID);

      now += 15 * 60 * 1000;
      passwordChangeTestDb.holdCredentialReadsUntil(6);
      const recovered = await wrongPasswordChange();
      assert.equal(recovered.status, 401, "a new password check is allowed after the limit window");
      assert.equal(recovered.body.error, "Current password is incorrect.");
      assert.equal(passwordChangeTestDb.credentialReadBarrierTimedOut, false);
      assert.equal(passwordChangeTestDb.credentialReadSnapshots.length, 6);
      assert.equal(passwordChangeTestDb.passwordWriteAttempts, 0);

      const afterRecovery = passwordChangeTestDb.snapshot();
      assert.equal(afterRecovery.password_salt, before.password_salt);
      assert.equal(afterRecovery.password_hash, before.password_hash);
      assert.equal(afterRecovery.auth_version, before.auth_version);
      const stillValidSession = await request(origin, "/auth/me", "GET", undefined, token);
      assert.equal(stillValidSession.status, 200);
      assert.equal(stillValidSession.body.id, PASSWORD_CHANGE_TEST_USER_ID);
    });
  } finally {
    Date.now = originalNow;
  }
});