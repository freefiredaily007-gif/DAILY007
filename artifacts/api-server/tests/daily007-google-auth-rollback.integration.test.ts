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
  resetMockGoogleUsers,
  type User as MockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";

const GOOGLE_CLERK_USER_ID = "clerk-google-postgres-rollback-test";
const GOOGLE_EMAIL = "google-postgres-rollback@example.test";
const SECOND_GOOGLE_CLERK_USER_ID = "clerk-google-postgres-independent-test";
const SECOND_GOOGLE_EMAIL = "google-postgres-independent@example.test";
const REFERRAL_CODE = "ABCDE";
const UNKNOWN_LEGACY_REFERRAL_CODE = "UNREGISTERED-LEGACY-CODE";
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

const SECOND_VERIFIED_GOOGLE_USER = {
  id: SECOND_GOOGLE_CLERK_USER_ID,
  firstName: "Second",
  lastName: "Postgres",
  emailAddresses: [{
    emailAddress: SECOND_GOOGLE_EMAIL,
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: SECOND_GOOGLE_EMAIL,
    firstName: "Second",
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

async function googleSignIn(
  origin: string,
  clerkUserId = GOOGLE_CLERK_USER_ID,
  referralCode: string | null = REFERRAL_CODE,
): Promise<JsonResult> {
  const response = await fetch(`${origin}/auth/google`, {
    method: "POST",
    headers: {
      authorization: "Bearer mocked-clerk-session",
      "content-type": "application/json",
      "x-mock-clerk-user-id": clerkUserId,
    },
    body: JSON.stringify({ referralCode }),
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

async function resetReferralRewardFailureTrigger(
  failedReason: "Referral Signup Bonus" | "Welcome Signup Bonus" = "Referral Signup Bonus",
): Promise<void> {
  await pool.query("DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger");
  await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_first_referral_reward()");
  await pool.query("DROP SEQUENCE IF EXISTS daily007_test_referral_reward_failure_seq");
  await pool.query("CREATE SEQUENCE daily007_test_referral_reward_failure_seq START 1");
  await pool.query(`
    CREATE FUNCTION daily007_test_fail_first_referral_reward()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.reason = '${failedReason}'
         AND nextval('daily007_test_referral_reward_failure_seq') = 1 THEN
        PERFORM pg_advisory_xact_lock(743003, 1);
        RAISE EXCEPTION 'Injected one-time signup reward ledger failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER daily007_test_referral_reward_failure
    BEFORE INSERT ON daily007_v2_wallet_ledger
    FOR EACH ROW
    EXECUTE FUNCTION daily007_test_fail_first_referral_reward()
  `);
}

test("a rejected legacy-style referral code rolls back Google signup before a valid-code retry", async () => {
  await pool.query(
    "DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger",
  );
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Postgres Test Referrer', $2, 'test-salt', 'test-hash')`,
    [referrerId, `referrer-${referrerId}@example.test`],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
    [referrerId, REFERRAL_CODE],
  );

  try {
    await withServer(async (origin) => {
      assert.ok(
        UNKNOWN_LEGACY_REFERRAL_CODE.length > REFERRAL_CODE.length,
        "the unrecognized code must use the longer legacy-code shape",
      );
      const rejected = await googleSignIn(
        origin,
        GOOGLE_CLERK_USER_ID,
        UNKNOWN_LEGACY_REFERRAL_CODE,
      );
      assert.equal(rejected.status, 400);
      assert.match(String(rejected.body.error), /referral code is not recognized/i);

      const rejectedSignupState = await pool.query<{
        accounts: number;
        referrals: number;
        legacyCodes: number;
        shortCodes: number;
        rewards: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM daily007_v2_users
             WHERE id <> $1 OR clerk_user_id IS NOT NULL) AS accounts,
           (SELECT count(*)::int FROM daily007_v2_referrals) AS referrals,
           (SELECT count(*)::int FROM daily007_v2_referral_codes) AS "legacyCodes",
           (SELECT count(*)::int FROM daily007_v2_referral_short_codes) AS "shortCodes",
           (SELECT count(*)::int FROM daily007_v2_wallet_ledger) AS rewards`,
        [referrerId],
      );
      assert.deepEqual(
        rejectedSignupState.rows[0],
        { accounts: 0, referrals: 0, legacyCodes: 0, shortCodes: 1, rewards: 0 },
        "the rejected transaction must leave no account, referral, generated legacy code, or wallet reward",
      );
      const rejectedIdentity = await pool.query(
        "SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1 OR email = $2",
        [GOOGLE_CLERK_USER_ID, GOOGLE_EMAIL],
      );
      assert.deepEqual(rejectedIdentity.rows, [], "the rejected signup must not retain the Google identity");

      const retry = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, REFERRAL_CODE);
      assert.equal(retry.status, 201, "the same Google identity should retry with a valid referral code");
      assert.equal(retry.body.coins, 10);
      assert.equal(typeof retry.body.token, "string");

      const accounts = await pool.query<{
        id: string;
        email: string;
        clerk_user_id: string;
        wallet_coins: number;
      }>(
        `SELECT id, email, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(accounts.rows, [{
        id: retry.body.id,
        email: GOOGLE_EMAIL,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
        wallet_coins: 10,
      }], "the retry must create exactly one Google-linked account and reward balance");

      const allAccounts = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_users",
      );
      assert.equal(allAccounts.rows[0]?.count, 2, "only the referrer and retried Google account should exist");

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals`,
      );
      assert.deepEqual(referrals.rows, [{
        referrer_user_id: referrerId,
        referred_user_id: String(retry.body.id),
        code: REFERRAL_CODE,
      }], "the retry must persist exactly one referral relationship");

      const generatedCodes = await pool.query<{
        legacy_codes: number;
        short_codes: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM daily007_v2_referral_codes) AS legacy_codes,
           (SELECT count(*)::int FROM daily007_v2_referral_short_codes) AS short_codes`,
      );
      assert.deepEqual(generatedCodes.rows[0], { legacy_codes: 1, short_codes: 2 });

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger`,
      );
      assert.deepEqual(rewards.rows, [{
        user_id: String(retry.body.id),
        amount: 10,
        balance_after: 10,
        reason: "Referral Signup Bonus",
      }], "the retry must persist exactly one 10-coin reward");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(retry.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
        "Wallet history must show exactly one reward entry after the successful retry",
      );
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = $1",
      [GOOGLE_CLERK_USER_ID],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    await resetReferralRewardFailureTrigger();
    resetMockGoogleUser();
  }
});

test("a waiting Google sign-in recovers after a real referral reward transaction rollback", async () => {
  await resetReferralRewardFailureTrigger();
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
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = $1",
      [GOOGLE_CLERK_USER_ID],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});

test("a waiting Google signup recovers after the welcome-bonus ledger insert rolls back", async () => {
  await resetReferralRewardFailureTrigger("Welcome Signup Bonus");
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

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

      firstSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
      const failingRequestPid = await waitForBlockedBackend(
        blocker.processID,
        "%INSERT INTO daily007_v2_wallet_ledger%",
        "first sign-in to pause at its welcome-bonus ledger write",
      );

      secondSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
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
        "the first request should fail and the identity-lock waiter should create the account",
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
      assert.equal(accounts.rows.length, 1, "only the successful retry's Google account should remain");
      const account = accounts.rows[0]!;
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, GOOGLE_EMAIL);
      assert.equal(account.wallet_coins, 10);

      const allAccounts = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_users",
      );
      assert.equal(allAccounts.rows[0]?.count, 1, "the rolled-back attempt must not leave a duplicate account");

      const generatedCodes = await pool.query<{
        legacy_codes: number;
        short_codes: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM daily007_v2_referral_codes) AS legacy_codes,
           (SELECT count(*)::int FROM daily007_v2_referral_short_codes) AS short_codes`,
      );
      assert.deepEqual(
        generatedCodes.rows[0],
        { legacy_codes: 1, short_codes: 1 },
        "only the successful retry's generated referral codes should remain",
      );

      const referrals = await pool.query(
        "SELECT id FROM daily007_v2_referrals",
      );
      assert.deepEqual(referrals.rows, [], "a signup without a referral code must not create a referral");

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1`,
        [account.id],
      );
      assert.deepEqual(rewards.rows, [{
        user_id: account.id,
        amount: 10,
        balance_after: 10,
        reason: "Welcome Signup Bonus",
      }], "the failed transaction must leave exactly one 10-coin welcome reward");

      const failureAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(
        failureAttempts.rows[0]?.last_value,
        "2",
        "the first welcome reward insert should fail and the waiting retry should pass",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(recoveredSignIn.body.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Welcome Signup Bonus" }],
        "Wallet history should show exactly one surviving welcome reward",
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
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = $1",
      [GOOGLE_CLERK_USER_ID],
    );
    resetMockGoogleUser();
  }
});

test("a separate Google signup remains committed when the other identity's referral reward rolls back", async () => {
  await resetReferralRewardFailureTrigger();
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);
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
  let failedSignIn: Promise<JsonResult> | undefined;
  let successfulSignIn: Promise<JsonResult> | undefined;
  try {
    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the trigger pause PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 1)");

      failedSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID);
      await waitForBlockedBackend(
        blocker.processID,
        "%INSERT INTO daily007_v2_wallet_ledger%",
        "the failed identity to pause at its referral reward ledger write",
      );

      successfulSignIn = googleSignIn(origin, SECOND_GOOGLE_CLERK_USER_ID);
      const successfulResult = await successfulSignIn;
      assert.equal(
        successfulResult.status,
        201,
        "the distinct identity should commit while the failed signup transaction remains open",
      );
      assert.equal(successfulResult.body.email, SECOND_GOOGLE_EMAIL);
      assert.equal(successfulResult.body.coins, 10);
      assert.equal(typeof successfulResult.body.token, "string");

      const committedAccount = await pool.query<{
        id: string;
        email: string;
        wallet_coins: number;
        clerk_user_id: string;
      }>(
        `SELECT id, email, wallet_coins, clerk_user_id
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [SECOND_GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(committedAccount.rows, [{
        id: successfulResult.body.id,
        email: SECOND_GOOGLE_EMAIL,
        wallet_coins: 10,
        clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
      }], "the second identity's account and reward must already be committed before releasing the failure");

      await blocker.query("COMMIT");
      pauseTransactionOpen = false;

      const failedResult = await failedSignIn;
      assert.equal(failedResult.status, 500, "the first identity's referral reward write should fail");

      const failedAccount = await pool.query(
        `SELECT id
           FROM daily007_v2_users
          WHERE clerk_user_id = $1 OR email = $2`,
        [GOOGLE_CLERK_USER_ID, GOOGLE_EMAIL],
      );
      assert.deepEqual(failedAccount.rows, [], "the failed identity must leave no account or identity link");

      const accounts = await pool.query<{ id: string; email: string; clerk_user_id: string | null }>(
        `SELECT id, email, clerk_user_id
           FROM daily007_v2_users
          ORDER BY email`,
      );
      assert.deepEqual(accounts.rows, [
        {
          id: successfulResult.body.id,
          email: SECOND_GOOGLE_EMAIL,
          clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
        },
        {
          id: referrerId,
          email: `referrer-${referrerId}@example.test`,
          clerk_user_id: null,
        },
      ], "only the referrer and successful Google account should remain");

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals`,
      );
      assert.deepEqual(referrals.rows, [{
        referrer_user_id: referrerId,
        referred_user_id: String(successfulResult.body.id),
        code: REFERRAL_CODE,
      }], "the failed identity must leave no referral, and the successful referral must remain");

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger`,
      );
      assert.deepEqual(rewards.rows, [{
        user_id: String(successfulResult.body.id),
        amount: 10,
        balance_after: 10,
        reason: "Referral Signup Bonus",
      }], "the failed identity must leave no wallet entry, and the successful reward must remain exactly once");

      const failedRewardAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(
        failedRewardAttempts.rows[0]?.last_value,
        "2",
        "both concurrent signup transactions should reach the one-shot referral reward trigger",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(successfulResult.body.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
        "Wallet history should show exactly the successful identity's reward",
      );
    });
  } finally {
    if (pauseTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      pauseTransactionOpen = false;
    }
    await Promise.all([
      failedSignIn?.catch(() => undefined),
      successfulSignIn?.catch(() => undefined),
    ]);
    blocker?.release();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_first_referral_reward()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_referral_reward_failure_seq");
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = ANY($1::text[])",
      [[GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});