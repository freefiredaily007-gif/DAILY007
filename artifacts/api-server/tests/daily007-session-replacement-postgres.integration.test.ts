import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { DAILY007_LOGIN_FAILURE_MESSAGE } from "../src/lib/daily007-login-password";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router, { hashPassword } from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-login-block-race-test-secret-at-least-32-chars";
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

type LoginResponse = {
  status: number;
  body: Record<string, unknown>;
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Test server encountered an unexpected error." });
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

async function login(
  origin: string,
  path: string,
  email: string,
  password: string,
  clientIp: string,
): Promise<LoginResponse> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({ email, password }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function authenticatedGet(
  origin: string,
  path: string,
  token: string,
): Promise<LoginResponse> {
  const response = await fetch(`${origin}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function waitForLoginBlockedBy(
  queryFragment: string,
  blockerPid: number,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity AS waiting
           CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(blocker_pid)
          WHERE waiting.pid <> pg_backend_pid()
            AND waiting.wait_event_type = 'Lock'
            AND waiting.query ILIKE $1
            AND blockers.blocker_pid = $2
       ) AS waiting`,
      [`%${queryFragment}%`, blockerPid],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

test("both password-login routes reject a login whose account is blocked before session rotation", async () => {
  await withServer(async (origin) => {
    const routes = [
      { label: "Daily007 v2", path: "/daily007/v2/auth/login" },
      { label: "compatibility", path: "/auth/login" },
    ];

    for (const [index, route] of routes.entries()) {
      const userId = randomUUID();
      const email = `login-block-race-${userId}@example.test`;
      const password = `valid-login-block-race-password-${userId}`;
      const clientIp = `198.51.100.${100 + index}`;
      const credentials = await hashPassword(password);
      let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
      let transactionOpen = false;
      let loginPromise: Promise<LoginResponse> | undefined;

      await pool.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash, status, auth_version)
         VALUES ($1, 'Login Block Race Test', $2, $3, $4, 'active', 0)`,
        [userId, email, credentials.salt, credentials.hash],
      );

      try {
        const unknownEmail = await login(
          origin,
          route.path,
          `unknown-${userId}@example.test`,
          password,
          clientIp,
        );
        assert.equal(unknownEmail.status, 401, `${route.label} unknown email should be rejected`);
        assert.deepEqual(unknownEmail.body, { error: DAILY007_LOGIN_FAILURE_MESSAGE });

        blocker = await pool.connect();
        assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the blocker backend PID");
        await blocker.query("BEGIN");
        transactionOpen = true;
        await blocker.query(
          "UPDATE daily007_v2_users SET status = 'blocked' WHERE id = $1",
          [userId],
        );

        loginPromise = login(origin, route.path, email, password, clientIp);
        await waitForLoginBlockedBy(
          "SET auth_version = auth_version + 1",
          blocker.processID,
          `${route.label} session-version update`,
        );

        await blocker.query("COMMIT");
        transactionOpen = false;
        const blockedLogin = await loginPromise;

        assert.equal(blockedLogin.status, unknownEmail.status, `${route.label} blocked account status`);
        assert.deepEqual(
          blockedLogin.body,
          unknownEmail.body,
          `${route.label} blocked account must receive the same generic response as an unknown email`,
        );
        assert.equal(blockedLogin.body.token, undefined, `${route.label} must not issue a token`);

        const account = await pool.query<{ status: string; auth_version: number }>(
          "SELECT status, auth_version FROM daily007_v2_users WHERE id = $1",
          [userId],
        );
        assert.equal(account.rows[0]?.status, "blocked", `${route.label} block must be committed`);
        assert.equal(
          account.rows[0]?.auth_version,
          0,
          `${route.label} must leave auth_version unchanged`,
        );
      } finally {
        if (transactionOpen && blocker) {
          await blocker.query("ROLLBACK");
          transactionOpen = false;
        }
        if (loginPromise) await loginPromise.catch(() => undefined);
        blocker?.release();
        await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
      }
    }
  });
});

test("both authenticated API surfaces reject a token after its account is blocked", async () => {
  const userId = randomUUID();
  const email = `existing-session-block-${userId}@example.test`;
  const password = `valid-existing-session-block-password-${userId}`;
  const credentials = await hashPassword(password);

  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, status, auth_version)
     VALUES ($1, 'Existing Session Block Test', $2, $3, $4, 'active', 0)`,
    [userId, email, credentials.salt, credentials.hash],
  );

  try {
    await withServer(async (origin) => {
      const loggedIn = await login(
        origin,
        "/daily007/v2/auth/login",
        email,
        password,
        "198.51.100.120",
      );
      assert.equal(loggedIn.status, 200);
      assert.equal(typeof loggedIn.body.token, "string");
      const token = loggedIn.body.token as string;

      const routes = [
        { label: "Daily007 v2", path: "/daily007/v2/auth/me" },
        { label: "compatibility", path: "/auth/me" },
      ];
      for (const route of routes) {
        const activeResponse = await authenticatedGet(origin, route.path, token);
        assert.equal(activeResponse.status, 200, `${route.label} accepts the active account token`);
      }

      await pool.query(
        "UPDATE daily007_v2_users SET status = 'blocked' WHERE id = $1",
        [userId],
      );

      for (const route of routes) {
        const blockedResponse = await authenticatedGet(origin, route.path, token);
        assert.equal(blockedResponse.status, 403, `${route.label} rejects the pre-block token`);
        assert.deepEqual(blockedResponse.body, { error: "This account is blocked." });
      }

      const blockedAccount = await pool.query<{
        status: string;
        auth_version: number;
      }>(
        "SELECT status, auth_version FROM daily007_v2_users WHERE id = $1",
        [userId],
      );
      assert.deepEqual(blockedAccount.rows[0], {
        status: "blocked",
        auth_version: 1,
      });
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
  }
});
