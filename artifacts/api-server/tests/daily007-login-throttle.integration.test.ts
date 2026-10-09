import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import {
  DAILY007_LOGIN_ATTEMPT_LIMIT,
  DAILY007_LOGIN_RATE_LIMIT_MESSAGE,
} from "../src/lib/daily007-login-throttle";
import { DAILY007_LOGIN_FAILURE_MESSAGE } from "../src/lib/daily007-login-password";
import { hashPassword } from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-login-throttle-process-test-secret";
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

type LoginResult = {
  status: number;
  body: { error?: string };
  retryAfter: string | null;
};

const apiProcesses: ApiProcess[] = [];

async function startApiProcess(): Promise<ApiProcess> {
  const child = spawn(process.execPath, ["/tmp/daily007-login-throttle-server.cjs"], {
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  const origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for login-throttle API process.")), 10_000);
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
      reject(new Error(`Login-throttle API process exited before starting (code ${code}). ${output}`));
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
          reject(new Error("Timed out stopping login-throttle API process."));
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

async function passwordLogin(
  origin: string,
  path: string,
  email: string,
  clientIp: string,
): Promise<LoginResult> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({ email, password: "incorrect-login-throttle-test-password" }),
  });
  return {
    status: response.status,
    body: await response.json() as { error?: string },
    retryAfter: response.headers.get("retry-after"),
  };
}

after(async () => {
  await Promise.all(apiProcesses.map((apiProcess) => apiProcess.stop()));
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

test("login limits and expiry are shared by separate API processes and both password routes", async () => {
  const userId = randomUUID();
  const knownEmail = `login-throttle-${userId}@example.test`;
  const password = await hashPassword("correct-login-throttle-test-password");
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Login Throttle Test', $2, $3, $4)`,
    [userId, knownEmail, password.salt, password.hash],
  );

  const firstProcess = await startApiProcess();
  const secondProcess = await startApiProcess();
  const clientIp = "198.51.100.90";
  const targets = [
    { origin: firstProcess.origin, path: "/daily007/v2/auth/login" },
    { origin: secondProcess.origin, path: "/auth/login" },
    { origin: firstProcess.origin, path: "/auth/login" },
    { origin: secondProcess.origin, path: "/daily007/v2/auth/login" },
  ];

  const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => {
    const target = targets[index % targets.length]!;
    const email = index % 2 === 0 ? knownEmail : `unknown-${userId}@example.test`;
    return passwordLogin(target.origin, target.path, email, clientIp);
  }));
  const allowed = attempts.filter((attempt) => attempt.status === 401);
  const limited = attempts.filter((attempt) => attempt.status === 429);

  assert.equal(allowed.length, DAILY007_LOGIN_ATTEMPT_LIMIT);
  assert.equal(limited.length, 20 - DAILY007_LOGIN_ATTEMPT_LIMIT);
  assert.ok(allowed.every((attempt) => attempt.body.error === DAILY007_LOGIN_FAILURE_MESSAGE));
  assert.ok(limited.every((attempt) =>
    attempt.body.error === DAILY007_LOGIN_RATE_LIMIT_MESSAGE &&
    Number(attempt.retryAfter) > 0 &&
    Number(attempt.retryAfter) <= 60
  ));

  const limitedKnown = await passwordLogin(
    firstProcess.origin,
    "/daily007/v2/auth/login",
    knownEmail,
    clientIp,
  );
  const limitedUnknown = await passwordLogin(
    secondProcess.origin,
    "/auth/login",
    `unknown-${userId}@example.test`,
    clientIp,
  );
  assert.equal(limitedKnown.status, 429);
  assert.equal(limitedUnknown.status, 429);
  assert.deepEqual(limitedKnown.body, limitedUnknown.body);

  const otherIp = await passwordLogin(
    secondProcess.origin,
    "/auth/login",
    knownEmail,
    "198.51.100.91",
  );
  assert.equal(otherIp.status, 401, "another IP must have its own attempt budget");

  const clientIpHash = createHash("sha256").update(clientIp).digest("hex");
  await pool.query(
    "UPDATE daily007_login_rate_limits SET expires_at = now() - interval '1 second' WHERE client_ip_hash = $1",
    [clientIpHash],
  );
  const recovered = await passwordLogin(
    secondProcess.origin,
    "/daily007/v2/auth/login",
    knownEmail,
    clientIp,
  );
  assert.equal(recovered.status, 401, "the same client may try again after the shared window expires");

  const recoveredCounter = await pool.query<{ attempts: number; expires_at: Date }>(
    "SELECT attempts, expires_at FROM daily007_login_rate_limits WHERE client_ip_hash = $1",
    [clientIpHash],
  );
  assert.equal(recoveredCounter.rows[0]?.attempts, 1);
  assert.ok(recoveredCounter.rows[0]?.expires_at.getTime() > Date.now());
});
