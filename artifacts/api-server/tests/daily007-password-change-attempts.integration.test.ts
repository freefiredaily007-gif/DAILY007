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

async function passwordChange(origin: string, token: string): Promise<{ status: number; retryAfter: string | null }> {
  const response = await fetch(`${origin}/auth/me/password`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "incorrect-current-password",
      newPassword: "replacement-password-for-shared-attempt-test",
    }),
  });
  await response.json();
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
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

  const storedLimit = await pool.query<{ failures: number; in_flight: number }>(
    "SELECT failures, in_flight FROM daily007_password_change_attempts WHERE user_id = $1",
    [userId],
  );
  assert.deepEqual(storedLimit.rows[0], { failures: 5, in_flight: 0 });

  await pool.query(
    "UPDATE daily007_password_change_attempts SET expires_at = now() - interval '1 second' WHERE user_id = $1",
    [userId],
  );
  const recovered = await passwordChange(concurrentProcess.origin, token);
  assert.equal(recovered.status, 401, "the account should accept a password check after the window expires");

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
