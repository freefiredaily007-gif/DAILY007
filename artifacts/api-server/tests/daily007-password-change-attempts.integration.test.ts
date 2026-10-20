import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import type { User as ClerkUser } from "@clerk/express";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007GoogleAuthRouter from "../src/routes/daily007-google-auth";
import { hashPassword } from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  getMockGoogleUserLookupCount,
  resetMockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";

const TEST_AUTH_SECRET = "daily007-password-change-attempts-test-secret";
const TEST_REPLACEMENT_PASSWORD = "replacement-password-for-shared-attempt-test";
const LINKED_GOOGLE_CLERK_USER_ID = "clerk-password-change-linked-google";
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

type ApiProcess = {
  origin: string;
  child: ChildProcessWithoutNullStreams;
  stop: () => Promise<void>;
};

const apiProcesses: ApiProcess[] = [];

async function startApiProcess(): Promise<ApiProcess> {
  const child = spawn(process.execPath, ["/tmp/daily007-password-change-server.cjs"], {
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  const origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for password-change API process.")), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const ready = output.match(/READY:(\d+)/);
      if (ready) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${ready[1]}`);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Password-change API process exited before starting (code ${code}). ${output}`));
    });
  });

  let stopPromise: Promise<void> | undefined;
  const apiProcess: ApiProcess = {
    origin,
    child,
    stop: () => {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Timed out stopping password-change API process."));
        }, 10_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
      return stopPromise;
    },
  };
  apiProcesses.push(apiProcess);
  return apiProcess;
}

async function withMockedGoogleAuthServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      auth: { userId: req.get("x-mock-clerk-user-id") ?? LINKED_GOOGLE_CLERK_USER_ID },
    });
    next();
  });
  app.use(daily007CompatCoreRouter);
  app.use(daily007GoogleAuthRouter);

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

async function passwordChange(
  origin: string,
  token: string,
  currentPassword = "incorrect-current-password",
  options: { dropResponseCount?: number; newPassword?: string; requestId?: string } = {},
): Promise<{ status: number; retryAfter: string | null }> {
  const response = await fetch(`${origin}/auth/me/password`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.dropResponseCount
        ? {
            "x-test-drop-password-change-response": "after-commit",
            "x-test-drop-password-change-response-count": String(options.dropResponseCount),
          }
        : {}),
    },
    body: JSON.stringify({
      currentPassword,
      newPassword: options.newPassword ?? TEST_REPLACEMENT_PASSWORD,
      requestId: options.requestId ?? randomUUID(),
    }),
  });
  await response.json();
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
}

async function passwordLogin(
  origin: string,
  email: string,
  password: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function waitForBlockedPasswordAttemptSettlements(blockerPid: number, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting_count: number }>(
      `SELECT count(*)::integer AS waiting_count
         FROM pg_stat_activity AS waiting
         CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(blocker_pid)
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE '%UPDATE daily007_password_change_attempts%'
          AND blockers.blocker_pid = $1`,
      [blockerPid],
    );
    if (result.rows[0]?.waiting_count === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expectedCount} password-change checks to overlap.`);
}

async function waitForSettledPasswordAttempts(
  userIds: string[],
): Promise<Array<{ user_id: string; failures: number; in_flight: number }>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ user_id: string; failures: number; in_flight: number }>(
      `SELECT user_id, failures, in_flight
         FROM daily007_password_change_attempts
        WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );
    if (result.rows.length === userIds.length && result.rows.every(({ in_flight }) => in_flight === 0)) {
      return result.rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for password-change attempts to settle for ${userIds.length} accounts.`);
}

after(async () => {
  await Promise.all(apiProcesses.map((apiProcess) => apiProcess.stop()));
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

test("password-change attempt limit survives process restart and is shared by concurrent API processes", async () => {
  const userId = randomUUID();
  const password = await hashPassword("current-password-for-process-sharing");
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Process Sharing Player', $2, $3, $4)`,
    [userId, `password-change-${userId}@example.test`, password.salt, password.hash],
  );
  const token = makeToken(userId, 0);
  assert.ok(token);

  const originalProcess = await startApiProcess();
  const firstFailures = await Promise.all([
    passwordChange(originalProcess.origin, token),
    passwordChange(originalProcess.origin, token),
  ]);
  assert.deepEqual(firstFailures.map(({ status }) => status), [401, 401]);
  await originalProcess.stop();

  const restartedProcess = await startApiProcess();
  const concurrentProcess = await startApiProcess();
  const nextAttempts = await Promise.all([
    passwordChange(restartedProcess.origin, token),
    passwordChange(concurrentProcess.origin, token),
    passwordChange(restartedProcess.origin, token),
    passwordChange(concurrentProcess.origin, token),
    passwordChange(restartedProcess.origin, token),
    passwordChange(concurrentProcess.origin, token),
  ]);
  assert.deepEqual(nextAttempts.map(({ status }) => status).sort(), [401, 401, 401, 429, 429, 429]);
  assert.ok(nextAttempts.some(({ status, retryAfter }) => status === 429 && Number(retryAfter) > 0));

  const storedLimit = await waitForSettledPasswordAttempts([userId]);
  assert.deepEqual(
    { failures: storedLimit[0]?.failures, in_flight: storedLimit[0]?.in_flight },
    { failures: 5, in_flight: 0 },
  );

  await pool.query(
    "UPDATE daily007_password_change_attempts SET expires_at = now() - interval '1 second' WHERE user_id = $1",
    [userId],
  );
  const recovered = await passwordChange(concurrentProcess.origin, token);
  assert.equal(recovered.status, 401, "the account should accept a password check after the window expires");

  await waitForSettledPasswordAttempts([userId]);
  const afterExpiry = await pool.query<{ failures: number; in_flight: number; expires_at: Date }>(
    "SELECT failures, in_flight, expires_at FROM daily007_password_change_attempts WHERE user_id = $1",
    [userId],
  );
  assert.deepEqual(
    { failures: afterExpiry.rows[0]?.failures, in_flight: afterExpiry.rows[0]?.in_flight },
    { failures: 1, in_flight: 0 },
  );
  assert.ok(afterExpiry.rows[0]?.expires_at.getTime() > Date.now());
});

test("exhausting one player's password-change attempts does not block another player", async () => {
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const firstCredentials = await hashPassword("first-player-current-password");
  const secondPassword = "second-player-current-password";
  const secondCredentials = await hashPassword(secondPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES
       ($1, 'First Attempt-Limit Player', $2, $3, $4),
       ($5, 'Second Attempt-Limit Player', $6, $7, $8)`,
    [
      firstUserId,
      `password-change-first-${firstUserId}@example.test`,
      firstCredentials.salt,
      firstCredentials.hash,
      secondUserId,
      `password-change-second-${secondUserId}@example.test`,
      secondCredentials.salt,
      secondCredentials.hash,
    ],
  );

  const firstToken = makeToken(firstUserId, 0);
  const secondToken = makeToken(secondUserId, 0);
  assert.ok(firstToken);
  assert.ok(secondToken);
  const api = await startApiProcess();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await passwordChange(api.origin, firstToken);
    assert.equal(result.status, 401, "each incorrect check should count against the first player's limit");
  }

  const firstPlayerLockedOut = await passwordChange(api.origin, firstToken);
  assert.equal(firstPlayerLockedOut.status, 429);
  assert.ok(Number(firstPlayerLockedOut.retryAfter) > 0);

  const secondPlayerCheck = await passwordChange(api.origin, secondToken, secondPassword);
  assert.equal(secondPlayerCheck.status, 200, "the second player's correct password check should remain available");
  assert.equal(secondPlayerCheck.retryAfter, null);

  const attemptRows = await waitForSettledPasswordAttempts([firstUserId, secondUserId]);
  const attemptsByUser = new Map(attemptRows.map(({ user_id, failures, in_flight }) => [
    user_id,
    { failures, in_flight },
  ]));
  assert.equal(attemptsByUser.size, 2);
  assert.deepEqual(attemptsByUser.get(firstUserId), { failures: 5, in_flight: 0 });
  assert.deepEqual(attemptsByUser.get(secondUserId), { failures: 0, in_flight: 0 });
});

test("a successful password change survives an API restart and resets only that player's incorrect checks", async () => {
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const firstPassword = "first-player-current-password";
  const secondPassword = "second-player-current-password";
  const firstEmail = `password-change-reset-first-${firstUserId}@example.test`;
  const firstCredentials = await hashPassword(firstPassword);
  const secondCredentials = await hashPassword(secondPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES
       ($1, 'First Reset Player', $2, $3, $4),
       ($5, 'Second Reset Player', $6, $7, $8)`,
    [
      firstUserId,
      firstEmail,
      firstCredentials.salt,
      firstCredentials.hash,
      secondUserId,
      `password-change-reset-second-${secondUserId}@example.test`,
      secondCredentials.salt,
      secondCredentials.hash,
    ],
  );

  const firstToken = makeToken(firstUserId, 0);
  const secondToken = makeToken(secondUserId, 0);
  assert.ok(firstToken);
  assert.ok(secondToken);
  const api = await startApiProcess();

  const failedChecks = await Promise.all([
    passwordChange(api.origin, firstToken),
    passwordChange(api.origin, secondToken),
  ]);
  assert.deepEqual(failedChecks.map(({ status }) => status), [401, 401]);

  const beforeSuccessfulChange = await waitForSettledPasswordAttempts([firstUserId, secondUserId]);
  const attemptsBeforeChange = new Map(beforeSuccessfulChange.map(({ user_id, failures, in_flight }) => [
    user_id,
    { failures, in_flight },
  ]));
  assert.deepEqual(attemptsBeforeChange.get(firstUserId), { failures: 1, in_flight: 0 });
  assert.deepEqual(attemptsBeforeChange.get(secondUserId), { failures: 1, in_flight: 0 });

  const successfulChange = await passwordChange(api.origin, firstToken, firstPassword);
  assert.equal(successfulChange.status, 200, "the first player's valid current password should permit a change");

  await api.stop();
  const restartedApi = await startApiProcess();

  const replacementPasswordLogin = await passwordLogin(
    restartedApi.origin,
    firstEmail,
    TEST_REPLACEMENT_PASSWORD,
  );
  assert.equal(replacementPasswordLogin.status, 200, "the replacement password should allow sign-in after the API restarts");
  assert.equal(replacementPasswordLogin.body.id, firstUserId);
  assert.equal(typeof replacementPasswordLogin.body.token, "string");

  const oldPasswordLogin = await passwordLogin(restartedApi.origin, firstEmail, firstPassword);
  assert.equal(oldPasswordLogin.status, 401, "the previous password should remain rejected after the API restarts");
  assert.equal(oldPasswordLogin.body.error, "Email or password is incorrect.");
  assert.equal(oldPasswordLogin.body.token, undefined);

  const afterSuccessfulChange = await waitForSettledPasswordAttempts([firstUserId, secondUserId]);
  const attemptsAfterChange = new Map(afterSuccessfulChange.map(({ user_id, failures, in_flight }) => [
    user_id,
    { failures, in_flight },
  ]));
  assert.deepEqual(attemptsAfterChange.get(firstUserId), { failures: 0, in_flight: 0 });
  assert.deepEqual(attemptsAfterChange.get(secondUserId), { failures: 1, in_flight: 0 });
});

test("exhausting rejected password changes does not block the original password after an API restart", async () => {
  const userId = randomUUID();
  const originalPassword = "original-password-after-rejected-change";
  const email = `password-change-rejected-restart-${userId}@example.test`;
  const originalCredentials = await hashPassword(originalPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Rejected Change Player', $2, $3, $4)`,
    [userId, email, originalCredentials.salt, originalCredentials.hash],
  );

  const token = makeToken(userId, 0);
  assert.ok(token);
  const api = await startApiProcess();

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejectedChange = await passwordChange(
        api.origin,
        token,
        "definitely-wrong-current-password",
      );
      assert.equal(
        rejectedChange.status,
        401,
        `incorrect current password attempt ${attempt + 1} must reject the change`,
      );
    }

    await waitForSettledPasswordAttempts([userId]);
    const rateLimitedChange = await passwordChange(
      api.origin,
      token,
      "definitely-wrong-current-password",
    );
    assert.equal(rateLimitedChange.status, 429, "the next password change must be blocked at the attempt limit");
    assert.ok(Number(rateLimitedChange.retryAfter) > 0);

    const beforeRestart = await pool.query<{ password_salt: string; password_hash: string }>(
      "SELECT password_salt, password_hash FROM daily007_v2_users WHERE id = $1",
      [userId],
    );
    assert.equal(beforeRestart.rows[0]?.password_salt, originalCredentials.salt);
    assert.equal(beforeRestart.rows[0]?.password_hash, originalCredentials.hash);

    const cooldownBeforeRestart = await pool.query<{
      failures: number;
      in_flight: number;
      expires_at: Date;
    }>(
      `SELECT failures, in_flight, expires_at
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(
      {
        failures: cooldownBeforeRestart.rows[0]?.failures,
        in_flight: cooldownBeforeRestart.rows[0]?.in_flight,
      },
      { failures: 5, in_flight: 0 },
      "the password-change cooldown should be exhausted before restart",
    );
    assert.ok(cooldownBeforeRestart.rows[0]?.expires_at.getTime() > Date.now());

    await api.stop();
    const restartedApi = await startApiProcess();

    const cooldownAfterRestart = await pool.query<{
      failures: number;
      in_flight: number;
      expires_at: Date;
    }>(
      `SELECT failures, in_flight, expires_at
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(
      {
        failures: cooldownAfterRestart.rows[0]?.failures,
        in_flight: cooldownAfterRestart.rows[0]?.in_flight,
      },
      { failures: 5, in_flight: 0 },
      "restarting the API must preserve the active password-change cooldown",
    );
    assert.equal(
      cooldownAfterRestart.rows[0]?.expires_at.getTime(),
      cooldownBeforeRestart.rows[0]?.expires_at.getTime(),
      "restarting the API must not change the password-change cooldown expiry",
    );

    const originalPasswordLogin = await passwordLogin(restartedApi.origin, email, originalPassword);
    assert.equal(
      originalPasswordLogin.status,
      200,
      "the correct password must still sign in while password changes are rate-limited",
    );
    assert.equal(originalPasswordLogin.body.id, userId);
    assert.equal(typeof originalPasswordLogin.body.token, "string");
    const signedInToken = originalPasswordLogin.body.token as string;

    const stillRateLimitedChange = await passwordChange(
      restartedApi.origin,
      signedInToken,
      originalPassword,
    );
    assert.equal(
      stillRateLimitedChange.status,
      429,
      "sign-in must work without clearing the active password-change cooldown",
    );
    assert.ok(Number(stillRateLimitedChange.retryAfter) > 0);

    const replacementPasswordLogin = await passwordLogin(
      restartedApi.origin,
      email,
      TEST_REPLACEMENT_PASSWORD,
    );
    assert.equal(replacementPasswordLogin.status, 401, "a rejected replacement password must not become active");
    assert.equal(replacementPasswordLogin.body.error, "Email or password is incorrect.");
    assert.equal(replacementPasswordLogin.body.token, undefined);

    const afterRestart = await pool.query<{ password_salt: string; password_hash: string }>(
      "SELECT password_salt, password_hash FROM daily007_v2_users WHERE id = $1",
      [userId],
    );
    assert.equal(afterRestart.rows[0]?.password_salt, originalCredentials.salt);
    assert.equal(afterRestart.rows[0]?.password_hash, originalCredentials.hash);

    const cooldownAfterSignIns = await pool.query<{
      failures: number;
      in_flight: number;
      expires_at: Date;
    }>(
      `SELECT failures, in_flight, expires_at
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(
      {
        failures: cooldownAfterSignIns.rows[0]?.failures,
        in_flight: cooldownAfterSignIns.rows[0]?.in_flight,
      },
      { failures: 5, in_flight: 0 },
      "sign-in must not consume or reset the password-change cooldown",
    );
    assert.equal(
      cooldownAfterSignIns.rows[0]?.expires_at.getTime(),
      cooldownBeforeRestart.rows[0]?.expires_at.getTime(),
      "sign-in must not extend the password-change cooldown",
    );
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
  }
});

test("the same password-change request recovers after multiple success replies are lost", async () => {
  const userId = randomUUID();
  const oldPassword = "password-before-lost-reply";
  const email = `password-change-lost-reply-${userId}@example.test`;
  const originalCredentials = await hashPassword(oldPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Lost Reply Player', $2, $3, $4)`,
    [userId, email, originalCredentials.salt, originalCredentials.hash],
  );

  const token = makeToken(userId, 0);
  assert.ok(token);
  let api = await startApiProcess();
  const requestId = randomUUID();

  try {
    for (let lostReply = 0; lostReply < 6; lostReply += 1) {
      let responseWasLost = false;
      try {
        await passwordChange(api.origin, token, oldPassword, {
          ...([0, 3].includes(lostReply) ? { dropResponseCount: 3 } : {}),
          requestId,
        });
      } catch {
        responseWasLost = true;
      }
      assert.equal(
        responseWasLost,
        true,
        `the test server should drop successful response ${lostReply + 1} after commit`,
      );

      const settledAttempts = await waitForSettledPasswordAttempts([userId]);
      assert.deepEqual(
        { failures: settledAttempts[0]?.failures, in_flight: settledAttempts[0]?.in_flight },
        { failures: 0, in_flight: 0 },
        "an exact replay must not consume the incorrect-current-password budget",
      );
      if (lostReply === 2) {
        await api.stop();
        api = await startApiProcess();
      }
    }

    const alteredReplay = await passwordChange(
      api.origin,
      token,
      "different-current-password-for-the-same-operation",
      { requestId },
    );
    assert.equal(
      alteredReplay.status,
      401,
      "reusing an operation ID with a different current password must not confirm the completed change",
    );
    const attemptsAfterAlteredReplay = await waitForSettledPasswordAttempts([userId]);
    assert.deepEqual(
      { failures: attemptsAfterAlteredReplay[0]?.failures, in_flight: attemptsAfterAlteredReplay[0]?.in_flight },
      { failures: 1, in_flight: 0 },
      "a different current-password payload must still consume the attempt budget",
    );

    const accountAfterLostReply = await pool.query<{ password_salt: string; password_hash: string }>(
      "SELECT password_salt, password_hash FROM daily007_v2_users WHERE id = $1",
      [userId],
    );
    assert.notEqual(accountAfterLostReply.rows[0]?.password_hash, originalCredentials.hash);
    assert.notEqual(accountAfterLostReply.rows[0]?.password_salt, originalCredentials.salt);

    const retry = await passwordChange(api.origin, token, oldPassword, { requestId });
    assert.equal(retry.status, 200, "the same request should confirm that its requested password is already active");
    const attemptsAfterRetry = await waitForSettledPasswordAttempts([userId]);
    assert.deepEqual(
      { failures: attemptsAfterRetry[0]?.failures, in_flight: attemptsAfterRetry[0]?.in_flight },
      { failures: 1, in_flight: 0 },
      "confirming the same completed request must not add another incorrect-password failure",
    );

    const accountAfterRetry = await pool.query<{ password_salt: string; password_hash: string }>(
      "SELECT password_salt, password_hash FROM daily007_v2_users WHERE id = $1",
      [userId],
    );
    assert.equal(accountAfterRetry.rows[0]?.password_hash, accountAfterLostReply.rows[0]?.password_hash);
    assert.equal(accountAfterRetry.rows[0]?.password_salt, accountAfterLostReply.rows[0]?.password_salt);

    const currentSession = await fetch(`${api.origin}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const currentAccount = await currentSession.json() as Record<string, unknown>;
    assert.equal(currentSession.status, 200, "the player's existing session should remain active through recovery");
    assert.equal(currentAccount.id, userId);

    const replacementLogin = await passwordLogin(api.origin, email, TEST_REPLACEMENT_PASSWORD);
    assert.equal(replacementLogin.status, 200, "the new password should confirm the committed change");
    assert.equal(replacementLogin.body.id, userId);

    const oldPasswordLogin = await passwordLogin(api.origin, email, oldPassword);
    assert.equal(oldPasswordLogin.status, 401, "the old password should no longer be active");
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
  }
});

test("changing a Daily007 password preserves linked Google sign-in", async () => {
  const userId = randomUUID();
  const originalPassword = "linked-google-original-password";
  const email = `password-change-google-${userId}@example.test`;
  const originalCredentials = await hashPassword(originalPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Linked Google Password Player', $2, $3, $4)`,
    [userId, email, originalCredentials.salt, originalCredentials.hash],
  );

  resetMockGoogleUser({
    id: LINKED_GOOGLE_CLERK_USER_ID,
    firstName: "Google",
    lastName: "Player",
    emailAddresses: [{
      emailAddress: email,
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: email,
      firstName: "Google",
      lastName: "Player",
      verification: { status: "verified" },
    }],
  } as ClerkUser);

  const token = makeToken(userId, 0);
  assert.ok(token);

  try {
    await withMockedGoogleAuthServer(async (origin) => {
      const linkResponse = await fetch(`${origin}/auth/google`, {
        method: "POST",
        headers: {
          authorization: "Bearer mocked-clerk-session",
          "content-type": "application/json",
          "X-Daily007-Token": token,
        },
        body: JSON.stringify({}),
      });
      const linked = await linkResponse.json() as Record<string, unknown>;
      assert.equal(linkResponse.status, 200, "the password account should explicitly link its Google identity");
      assert.equal(linked.googleLinked, true);
      assert.equal(linked.id, userId);
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const passwordUpdate = await passwordChange(origin, token, originalPassword);
      assert.equal(passwordUpdate.status, 200, "the existing Daily007 password should authorize the update");

      const storedAccount = await pool.query<{
        clerk_user_id: string | null;
        password_salt: string;
        password_hash: string;
      }>(
        `SELECT clerk_user_id, password_salt, password_hash
           FROM daily007_v2_users
          WHERE id = $1`,
        [userId],
      );
      assert.equal(storedAccount.rows[0]?.clerk_user_id, LINKED_GOOGLE_CLERK_USER_ID);
      assert.notEqual(storedAccount.rows[0]?.password_salt, originalCredentials.salt);
      assert.notEqual(storedAccount.rows[0]?.password_hash, originalCredentials.hash);

      const replacementLogin = await passwordLogin(origin, email, TEST_REPLACEMENT_PASSWORD);
      assert.equal(replacementLogin.status, 200, "the replacement Daily007 password should work");
      assert.equal(replacementLogin.body.id, userId);

      const previousLogin = await passwordLogin(origin, email, originalPassword);
      assert.equal(previousLogin.status, 401, "the previous Daily007 password should no longer work");

      const googleSignIn = await fetch(`${origin}/auth/google`, {
        method: "POST",
        headers: {
          authorization: "Bearer mocked-clerk-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const googleSession = await googleSignIn.json() as Record<string, unknown>;
      assert.equal(googleSignIn.status, 200, "the linked Google identity should still sign in");
      assert.equal(googleSession.id, userId, "Google sign-in should return the same Daily007 account");
      assert.equal(typeof googleSession.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 2, "sign-in should verify the identity through the mocked provider");

      const linkAfterSignIn = await pool.query<{ clerk_user_id: string | null }>(
        "SELECT clerk_user_id FROM daily007_v2_users WHERE id = $1",
        [userId],
      );
      assert.equal(linkAfterSignIn.rows[0]?.clerk_user_id, LINKED_GOOGLE_CLERK_USER_ID);
    });
  } finally {
    resetMockGoogleUser();
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
  }
});

test("overlapping password checks keep separate retry rows and counters for two players", async () => {
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const firstPassword = "first-overlap-current-password";
  const secondPassword = "second-overlap-current-password";
  const firstCredentials = await hashPassword(firstPassword);
  const secondCredentials = await hashPassword(secondPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES
       ($1, 'First Overlap Player', $2, $3, $4),
       ($5, 'Second Overlap Player', $6, $7, $8)`,
    [
      firstUserId,
      `password-change-overlap-first-${firstUserId}@example.test`,
      firstCredentials.salt,
      firstCredentials.hash,
      secondUserId,
      `password-change-overlap-second-${secondUserId}@example.test`,
      secondCredentials.salt,
      secondCredentials.hash,
    ],
  );

  const firstToken = makeToken(firstUserId, 0);
  const secondToken = makeToken(secondUserId, 0);
  assert.ok(firstToken);
  assert.ok(secondToken);

  const lockKey = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 15)}`).toString();
  await pool.query(
    `CREATE FUNCTION daily007_test_pause_password_attempt_settlement() RETURNS trigger AS $function$
     BEGIN
       IF NEW.in_flight < OLD.in_flight THEN
         PERFORM pg_advisory_xact_lock(${lockKey}::bigint);
       END IF;
       RETURN NEW;
     END;
     $function$ LANGUAGE plpgsql`,
  );
  await pool.query(
    `CREATE TRIGGER daily007_test_pause_password_attempt_settlement
       BEFORE UPDATE ON daily007_password_change_attempts
       FOR EACH ROW
       EXECUTE FUNCTION daily007_test_pause_password_attempt_settlement()`,
  );

  const blocker = await pool.connect();
  const apiForFirstPlayer = await startApiProcess();
  const apiForSecondPlayer = await startApiProcess();
  const pendingChecks = [
    passwordChange(apiForFirstPlayer.origin, firstToken),
    passwordChange(apiForSecondPlayer.origin, secondToken, secondPassword),
  ];
  try {
    await blocker.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
    const blockerPid = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await waitForBlockedPasswordAttemptSettlements(blockerPid.rows[0].pid, 2);

    const inFlightRows = await pool.query<{ user_id: string; failures: number; in_flight: number }>(
      `SELECT user_id, failures, in_flight
         FROM daily007_password_change_attempts
        WHERE user_id = ANY($1::uuid[])`,
      [[firstUserId, secondUserId]],
    );
    assert.deepEqual(
      new Map(inFlightRows.rows.map(({ user_id, failures, in_flight }) => [user_id, { failures, in_flight }])),
      new Map([
        [firstUserId, { failures: 0, in_flight: 1 }],
        [secondUserId, { failures: 0, in_flight: 1 }],
      ]),
      "both separate accounts should hold an in-flight retry reservation at once",
    );
  } finally {
    await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
    await Promise.allSettled(pendingChecks);
    await pool.query("DROP TRIGGER daily007_test_pause_password_attempt_settlement ON daily007_password_change_attempts");
    await pool.query("DROP FUNCTION daily007_test_pause_password_attempt_settlement()");
    blocker.release();
  }

  const results = await Promise.all(pendingChecks);
  assert.deepEqual(results.map(({ status }) => status), [401, 200]);

  const attemptRows = await waitForSettledPasswordAttempts([firstUserId, secondUserId]);
  assert.equal(attemptRows.length, 2, "each player should have exactly one limiter row");
  const attemptsByUser = new Map(attemptRows.map(({ user_id, failures, in_flight }) => [
    user_id,
    { failures, in_flight },
  ]));
  assert.deepEqual(attemptsByUser.get(firstUserId), { failures: 1, in_flight: 0 });
  assert.deepEqual(attemptsByUser.get(secondUserId), { failures: 0, in_flight: 0 });
});

test("an older password check cannot settle into a newer retry window", async () => {
  const userId = randomUUID();
  const currentPassword = "password-change-window-race-current-password";
  const credentials = await hashPassword(currentPassword);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Retry Window Race Player', $2, $3, $4)`,
    [userId, `password-change-window-race-${userId}@example.test`, credentials.salt, credentials.hash],
  );
  const token = makeToken(userId, 0);
  assert.ok(token);

  const lockKey = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 15)}`).toString();
  await pool.query(
    `CREATE FUNCTION daily007_test_arm_old_password_attempt_settlement() RETURNS trigger AS $function$
     BEGIN
       UPDATE daily007_test_password_change_attempt_control
          SET armed = FALSE, pause_settlement = TRUE
        WHERE singleton = TRUE AND armed = TRUE;
       RETURN NULL;
     END;
     $function$ LANGUAGE plpgsql`,
  );
  await pool.query(
    `CREATE TRIGGER daily007_test_arm_old_password_attempt_settlement
       AFTER INSERT ON daily007_password_change_attempts
       FOR EACH STATEMENT
       EXECUTE FUNCTION daily007_test_arm_old_password_attempt_settlement()`,
  );
  await pool.query(
    `CREATE FUNCTION daily007_test_pause_old_password_attempt_settlement() RETURNS trigger AS $function$
     DECLARE should_pause boolean;
     BEGIN
       SELECT pause_settlement
         INTO should_pause
         FROM daily007_test_password_change_attempt_control
        WHERE singleton = TRUE;
       IF should_pause THEN
         PERFORM pg_advisory_xact_lock(${lockKey}::bigint);
         UPDATE daily007_test_password_change_attempt_control
            SET settlement_released = TRUE
          WHERE singleton = TRUE;
       END IF;
       RETURN NULL;
     END;
     $function$ LANGUAGE plpgsql`,
  );
  await pool.query(
    `CREATE TRIGGER daily007_test_pause_old_password_attempt_settlement
       BEFORE UPDATE ON daily007_password_change_attempts
       FOR EACH STATEMENT
       EXECUTE FUNCTION daily007_test_pause_old_password_attempt_settlement()`,
  );
  await pool.query(
    `CREATE FUNCTION daily007_test_mark_old_password_attempt_settlement_finished() RETURNS trigger AS $function$
     BEGIN
       UPDATE daily007_test_password_change_attempt_control
          SET settlement_finished = TRUE
        WHERE singleton = TRUE AND settlement_released = TRUE;
       RETURN NULL;
     END;
     $function$ LANGUAGE plpgsql`,
  );
  await pool.query(
    `CREATE TRIGGER daily007_test_mark_old_password_attempt_settlement_finished
       AFTER UPDATE ON daily007_password_change_attempts
       FOR EACH STATEMENT
       EXECUTE FUNCTION daily007_test_mark_old_password_attempt_settlement_finished()`,
  );

  const blocker = await pool.connect();
  const api = await startApiProcess();
  let blockerPid: number | undefined;
  let oldCheck: Promise<{ status: number; retryAfter: string | null }> | undefined;
  let newCheck: Promise<{ status: number; retryAfter: string | null }> | undefined;
  try {
    await blocker.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
    const blockerResult = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    blockerPid = blockerResult.rows[0]?.pid;
    assert.ok(blockerPid);

    await pool.query(
      `UPDATE daily007_test_password_change_attempt_control
          SET armed = TRUE, pause_settlement = FALSE,
              settlement_released = FALSE, settlement_finished = FALSE
        WHERE singleton = TRUE`,
    );
    oldCheck = passwordChange(api.origin, token, currentPassword);
    await waitForBlockedPasswordAttemptSettlements(blockerPid, 1);

    const oldWindow = await pool.query<{
      window_id: string; failures: number; in_flight: number;
    }>(
      `SELECT window_id, failures, in_flight
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.equal(oldWindow.rows.length, 1);
    assert.deepEqual(
      { failures: oldWindow.rows[0]?.failures, in_flight: oldWindow.rows[0]?.in_flight },
      { failures: 0, in_flight: 1 },
      "the older check must be held before its retry-window settlement",
    );
    const oldWindowId = oldWindow.rows[0]?.window_id;
    assert.ok(oldWindowId);

    // The old route query is paused in a statement trigger, before it takes a
    // row lock, so the test can expire the old window and admit a fresh check.
    await pool.query(
      `UPDATE daily007_test_password_change_attempt_control
          SET pause_settlement = FALSE
        WHERE singleton = TRUE`,
    );
    await pool.query(
      "UPDATE daily007_password_change_attempts SET expires_at = now() - interval '1 second' WHERE user_id = $1",
      [userId],
    );

    newCheck = passwordChange(
      api.origin,
      token,
      "incorrect-current-password",
      { newPassword: "different-password-after-window-expiry" },
    );
    const newResult = await newCheck;
    assert.equal(newResult.status, 401, "the new check should run in the fresh retry window");
    await waitForSettledPasswordAttempts([userId]);
    const newWindow = await pool.query<{
      window_id: string; failures: number; in_flight: number;
    }>(
      `SELECT window_id, failures, in_flight
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.equal(newWindow.rows.length, 1);
    assert.notEqual(newWindow.rows[0]?.window_id, oldWindowId, "expiry should create a distinct window");
    assert.deepEqual(
      { failures: newWindow.rows[0]?.failures, in_flight: newWindow.rows[0]?.in_flight },
      { failures: 1, in_flight: 0 },
      "the new check should settle only its own failure in the fresh window",
    );

    await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
    const oldResult = await oldCheck;
    assert.equal(oldResult.status, 200, "the older correct-password check should finish normally");
    const settlementDeadline = Date.now() + 5_000;
    while (Date.now() < settlementDeadline) {
      const settlement = await pool.query<{ settlement_finished: boolean }>(
        `SELECT settlement_finished
           FROM daily007_test_password_change_attempt_control
          WHERE singleton = TRUE`,
      );
      if (settlement.rows[0]?.settlement_finished) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const settlement = await pool.query<{ settlement_finished: boolean }>(
      `SELECT settlement_finished
         FROM daily007_test_password_change_attempt_control
        WHERE singleton = TRUE`,
    );
    assert.equal(settlement.rows[0]?.settlement_finished, true, "the old settlement statement must finish before comparing counters");
    const finalWindow = await pool.query<{
      window_id: string; failures: number; in_flight: number;
    }>(
      `SELECT window_id, failures, in_flight
         FROM daily007_password_change_attempts
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(
      finalWindow.rows[0],
      newWindow.rows[0],
      "the older completion must not change the newer window's identity or counters",
    );
  } finally {
    await pool.query(
      `UPDATE daily007_test_password_change_attempt_control
          SET armed = FALSE, pause_settlement = FALSE,
              settlement_released = FALSE, settlement_finished = FALSE
        WHERE singleton = TRUE`,
    );
    await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
    await Promise.allSettled([oldCheck, newCheck].filter(
      (promise): promise is Promise<{ status: number; retryAfter: string | null }> => Boolean(promise),
    ));
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_old_password_attempt_settlement ON daily007_password_change_attempts");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_old_password_attempt_settlement()");
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_arm_old_password_attempt_settlement ON daily007_password_change_attempts");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_arm_old_password_attempt_settlement()");
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_mark_old_password_attempt_settlement_finished ON daily007_password_change_attempts");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_mark_old_password_attempt_settlement_finished()");
    blocker.release();
  }
});
