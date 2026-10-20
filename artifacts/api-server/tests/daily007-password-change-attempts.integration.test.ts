import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { hashPassword } from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";

const TEST_AUTH_SECRET = "daily007-password-change-attempts-test-secret";
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

async function passwordChange(
  origin: string,
  token: string,
  currentPassword = "incorrect-current-password",
): Promise<{ status: number; retryAfter: string | null }> {
  const response = await fetch(`${origin}/auth/me/password`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      currentPassword,
      newPassword: "replacement-password-for-shared-attempt-test",
    }),
  });
  await response.json();
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
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

test("a successful password change resets only that player's previous incorrect checks", async () => {
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const firstPassword = "first-player-current-password";
  const secondPassword = "second-player-current-password";
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
      `password-change-reset-first-${firstUserId}@example.test`,
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

  const afterSuccessfulChange = await waitForSettledPasswordAttempts([firstUserId, secondUserId]);
  const attemptsAfterChange = new Map(afterSuccessfulChange.map(({ user_id, failures, in_flight }) => [
    user_id,
    { failures, in_flight },
  ]));
  assert.deepEqual(attemptsAfterChange.get(firstUserId), { failures: 0, in_flight: 0 });
  assert.deepEqual(attemptsAfterChange.get(secondUserId), { failures: 1, in_flight: 0 });
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
  const credentials = await hashPassword("password-change-window-race-current-password");
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
          SET armed = TRUE, pause_settlement = FALSE
        WHERE singleton = TRUE`,
    );
    oldCheck = passwordChange(api.origin, token);
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

    newCheck = passwordChange(api.origin, token);
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
    assert.equal(oldResult.status, 401, "the older incorrect-password check should finish normally");
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
          SET armed = FALSE, pause_settlement = FALSE
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
    blocker.release();
  }
});
