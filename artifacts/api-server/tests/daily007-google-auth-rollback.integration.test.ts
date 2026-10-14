import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import type { User } from "@clerk/express";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007GoogleAuthRouter from "../src/routes/daily007-google-auth";
import daily007V2Router from "../src/routes/daily007-v2";
import {
  resetMockGoogleUser,
  type User as MockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";

const GOOGLE_CLERK_USER_ID = "clerk-google-postgres-rollback-test";
const GOOGLE_EMAIL = "google-postgres-rollback@example.test";
const REFERRAL_CODE = "ABCDE";
const TEST_AUTH_SECRET = "google-postgres-rollback-tests-only-secret-at-least-32-chars";
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

const VERIFIED_GOOGLE_USER = {
  id: GOOGLE_CLERK_USER_ID,
  firstName: "Google",
  lastName: "Postgres",
  emailAddresses: [{
    emailAddress: GOOGLE_EMAIL,
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: GOOGLE_EMAIL,
    firstName: "Google",
    lastName: "Postgres",
    verification: { status: "verified" },
  }],
} as unknown as User;

type JsonResult = { status: number; body: Record<string, unknown> };

after(async () => {
  resetMockGoogleUser();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    Object.assign(request, {
      auth: { userId: request.get("x-mock-clerk-user-id") ?? GOOGLE_CLERK_USER_ID },
    });
    next();
  });
  app.use(daily007V2Router);
  app.use(daily007GoogleAuthRouter);
  app.use(daily007CompatExtraRouter);
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

async function googleSignIn(origin: string): Promise<JsonResult> {
  const response = await fetch(`${origin}/auth/google`, {
    method: "POST",
    headers: {
      authorization: "Bearer mocked-clerk-session",
      "content-type": "application/json",
    },
    body: JSON.stringify({ referralCode: REFERRAL_CODE }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function waitForBlockedBackend(
  blockerPid: number,
  queryPattern: string,
  description: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT waiting.pid
         FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $1
          AND $2 = ANY(pg_blocking_pids(waiting.pid))
        ORDER BY waiting.query_start
        LIMIT 1`,
      [queryPattern, blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

test("a waiting Google sign-in recovers after a real referral reward transaction rollback", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Postgres Test Referrer', $2, 'test-salt', 'test-hash')`,
    [referrerId, `referrer-${referrerId}@example.test`],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
    [referrerId, REFERRAL_CODE],
  );

  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseTransactionOpen = false;
  let firstSignIn: Promise<JsonResult> | undefined;
  let secondSignIn: Promise<JsonResult> | undefined;
  try {
    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the trigger pause PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 1)");

      firstSignIn = googleSignIn(origin);
      const failingRequestPid = await waitForBlockedBackend(
        blocker.processID,
        "%INSERT INTO daily007_v2_wallet_ledger%",
        "first sign-in to pause at its referral reward ledger write",
      );

      secondSignIn = googleSignIn(origin);
      await waitForBlockedBackend(
        failingRequestPid,
        "%pg_advisory_xact_lock%",
        "second sign-in to wait on the first sign-in's identity lock",
      );

      await blocker.query("COMMIT");
      pauseTransactionOpen = false;

      const results = await Promise.all([firstSignIn, secondSignIn]);
      assert.deepEqual(
        results.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "the first request should fail and the identity-lock waiter should succeed",
      );

      const recoveredSignIn = results.find(({ status }) => status === 201);
      assert.ok(recoveredSignIn);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const accounts = await pool.query<{
        id: string;
        email: string;
        wallet_coins: number;
        clerk_user_id: string;
      }>(
        `SELECT id, email, wallet_coins, clerk_user_id
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [GOOGLE_CLERK_USER_ID],
      );
      assert.equal(accounts.rows.length, 1, "the failed account insert must roll back before the waiter retries");
      const account = accounts.rows[0]!;
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, GOOGLE_EMAIL);
      assert.equal(account.wallet_coins, 10);

      const allAccounts = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_users",
      );
      assert.equal(allAccounts.rows[0]?.count, 2, "only the referrer and one referred account should remain");

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          WHERE referred_user_id = $1`,
        [account.id],
      );
      assert.deepEqual(referrals.rows, [{
        referrer_user_id: referrerId,
        referred_user_id: account.id,
        code: REFERRAL_CODE,
      }], "only the successful retry's referral should remain");

      const rewards = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1`,
        [account.id],
      );
      assert.deepEqual(rewards.rows, [{
        amount: 10,
        balance_after: 10,
        reason: "Referral Signup Bonus",
      }], "the failure must leave no partial or duplicate wallet reward");

      const failureAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(failureAttempts.rows[0]?.last_value, "2", "the trigger should fail once, then allow the retry");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(recoveredSignIn.body.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
        "Wallet history should expose exactly the surviving reward",
      );
    });
  } finally {
    if (pauseTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      pauseTransactionOpen = false;
    }
    await Promise.all([
      firstSignIn?.catch(() => undefined),
      secondSignIn?.catch(() => undefined),
    ]);
    blocker?.release();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_first_referral_reward()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_referral_reward_failure_seq");
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});
