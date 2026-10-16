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

const GOOGLE_CLERK_USER_ID = "clerk-google-stale-session-postgres-test";
const GOOGLE_EMAIL = "google-stale-session-postgres@example.test";
const REFERRAL_CODE = "ABCDE";
const ACCOUNT_EMAIL = GOOGLE_EMAIL;
const ACCOUNT_PASSWORD = "google-link-postgres-test-password";
const TEST_AUTH_SECRET = "google-stale-session-tests-only-secret-at-least-32-chars";
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
type WalletEntry = {
  amount: number;
  balanceAfter: number;
  reason: string;
};
type AccountSnapshot = {
  auth_version: number;
  clerk_user_id: string | null;
  wallet_coins: number;
};
type ReferralSnapshot = {
  referrer_user_id: string;
  referred_user_id: string;
  code: string;
};
type LedgerSnapshot = {
  amount: number;
  balance_after: number;
  reason: string;
  idempotency_key: string | null;
};

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

async function postJson(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function login(origin: string, clientIp: string): Promise<string> {
  const response = await postJson(origin, "/daily007/v2/auth/login", {
    email: ACCOUNT_EMAIL,
    password: ACCOUNT_PASSWORD,
  }, { "x-forwarded-for": clientIp });
  assert.equal(response.status, 200, "password sign-in should succeed");
  assert.equal(typeof response.body.token, "string");
  return String(response.body.token);
}

async function waitForQueryBlockedBy(
  monitor: NonNullable<Awaited<ReturnType<typeof pool.connect>>>,
  queryFragment: string,
  blockerPids: number[],
  description: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await monitor.query("SELECT pg_stat_clear_snapshot()");
    const result = await monitor.query<{ pid: number }>(
      `SELECT waiting.pid
         FROM pg_stat_activity AS waiting
         CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blockers(blocker_pid)
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $1
          AND blockers.blocker_pid = ANY($2::integer[])
        ORDER BY waiting.query_start
        LIMIT 1`,
      [`%${queryFragment}%`, blockerPids],
    );
    const waitingPid = result.rows[0]?.pid;
    if (waitingPid !== undefined) return waitingPid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

async function readWalletHistory(origin: string, token: string): Promise<{
  status: number;
  history: WalletEntry[];
}> {
  const response = await fetch(`${origin}/wallet/transactions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    history: response.status === 200
      ? await response.json() as WalletEntry[]
      : [],
  };
}

test("a replaced Daily007 session cannot link Google or create referral rewards in PostgreSQL", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  let accountId: string | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Postgres Referral Owner', $2, 'test-salt', 'test-hash')`,
      [referrerId, `referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );

    await withServer(async (origin) => {
      const registration = await postJson(origin, "/daily007/v2/auth/register", {
        name: "Google Link Player",
        email: ACCOUNT_EMAIL,
        password: ACCOUNT_PASSWORD,
      });
      assert.equal(registration.status, 201, "password account should be created");
      accountId = String((registration.body.account as Record<string, unknown>).id);

      const staleToken = await login(origin, "198.51.100.1");
      const replacementToken = await login(origin, "198.51.100.2");
      assert.notEqual(replacementToken, staleToken, "the second sign-in should replace the first token");

      const validReferral = await pool.query<{ user_id: string }>(
        "SELECT user_id FROM daily007_v2_referral_codes WHERE code = $1",
        [REFERRAL_CODE],
      );
      assert.equal(validReferral.rows[0]?.user_id, referrerId, "the test referral code should be valid");

      const beforeAccount = await pool.query<AccountSnapshot>(
        `SELECT auth_version, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.equal(beforeAccount.rows.length, 1);
      assert.equal(beforeAccount.rows[0]?.clerk_user_id, null);
      const beforeReferrals = await pool.query<ReferralSnapshot>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      const beforeLedger = await pool.query<LedgerSnapshot>(
        `SELECT amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      const walletBefore = await readWalletHistory(origin, replacementToken);
      assert.equal(walletBefore.status, 200, "replacement session should work before the link attempt");

      const linkAttempt = await postJson(origin, "/auth/google", { referralCode: REFERRAL_CODE }, {
        authorization: "Bearer mocked-clerk-session",
        "x-mock-clerk-user-id": GOOGLE_CLERK_USER_ID,
        "X-Daily007-Token": staleToken,
      });
      assert.equal(linkAttempt.status, 401, "the replaced token should be rejected");
      assert.match(String(linkAttempt.body.error), /session was replaced/i);

      const afterAccount = await pool.query<AccountSnapshot>(
        `SELECT auth_version, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.deepEqual(afterAccount.rows, beforeAccount.rows, "the stale request must not link or change the account balance");
      const linkedIdentity = await pool.query<{ id: string }>(
        "SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1",
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(linkedIdentity.rows, [], "the Google identity must remain unlinked");
      const afterReferrals = await pool.query<ReferralSnapshot>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      assert.deepEqual(afterReferrals.rows, beforeReferrals.rows, "the stale request must not create a referral");
      const afterLedger = await pool.query<LedgerSnapshot>(
        `SELECT amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      assert.deepEqual(afterLedger.rows, beforeLedger.rows, "the stale request must not change wallet history");

      const walletAfter = await readWalletHistory(origin, replacementToken);
      assert.equal(walletAfter.status, 200, "replacement session should remain usable after rejection");
      assert.deepEqual(walletAfter.history, walletBefore.history, "replacement-session wallet history should be unchanged");
      assert.deepEqual(
        walletAfter.history.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Welcome Signup Bonus" }],
      );
    });
  } finally {
    if (accountId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [accountId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});

test("Google linking waits for a newer password sign-in and rejects its replaced session in PostgreSQL", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  let accountId: string | undefined;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let transactionOpen = false;
  let signInPromise: Promise<JsonResult> | undefined;
  let linkPromise: Promise<JsonResult> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Postgres Referral Owner', $2, 'test-salt', 'test-hash')`,
      [referrerId, `referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );

    await withServer(async (origin) => {
      const registration = await postJson(origin, "/daily007/v2/auth/register", {
        name: "Google Link Player",
        email: ACCOUNT_EMAIL,
        password: ACCOUNT_PASSWORD,
      });
      assert.equal(registration.status, 201, "password account should be created");
      accountId = String((registration.body.account as Record<string, unknown>).id);

      const oldToken = await login(origin, "198.51.100.4");
      const beforeAccount = await pool.query<AccountSnapshot>(
        `SELECT auth_version, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.equal(beforeAccount.rows.length, 1);
      assert.equal(beforeAccount.rows[0]?.clerk_user_id, null);
      const beforeLedger = await pool.query<LedgerSnapshot>(
        `SELECT amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      const beforeReferrals = await pool.query<ReferralSnapshot>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      const beforeReferrer = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [referrerId],
      );

      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the lock-holder backend PID");
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [accountId],
      );
      const blockerPid = blocker.processID!;

      signInPromise = postJson(origin, "/daily007/v2/auth/login", {
        email: ACCOUNT_EMAIL,
        password: ACCOUNT_PASSWORD,
      }, { "x-forwarded-for": "198.51.100.5" });
      const signInPid = await waitForQueryBlockedBy(
        blocker,
        "SET auth_version = auth_version + 1",
        [blockerPid],
        "password sign-in session-version update",
      );

      linkPromise = postJson(origin, "/auth/google", { referralCode: REFERRAL_CODE }, {
        authorization: "Bearer mocked-clerk-session",
        "x-mock-clerk-user-id": GOOGLE_CLERK_USER_ID,
        "X-Daily007-Token": oldToken,
      });
      await waitForQueryBlockedBy(
        blocker,
        "FROM daily007_v2_users WHERE email = $1 FOR UPDATE",
        [blockerPid, signInPid],
        "Google-link account lookup",
      );

      await blocker.query("COMMIT");
      transactionOpen = false;
      const [signIn, linkAttempt] = await Promise.all([signInPromise, linkPromise]);
      assert.equal(signIn.status, 200, "the queued password sign-in should succeed");
      assert.equal(typeof signIn.body.token, "string", "the newer password session should receive a token");
      assert.equal(linkAttempt.status, 401, "Google linking with the replaced session must be rejected");
      assert.match(String(linkAttempt.body.error), /session was replaced/i);

      const newToken = String(signIn.body.token);
      assert.notEqual(newToken, oldToken, "password sign-in should issue a replacement token");
      const afterAccount = await pool.query<AccountSnapshot>(
        `SELECT auth_version, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.deepEqual(
        afterAccount.rows,
        [{
          ...beforeAccount.rows[0],
          auth_version: Number(beforeAccount.rows[0]!.auth_version) + 1,
        }],
        "only the successful password sign-in should advance the session version",
      );
      const linkedIdentity = await pool.query<{ id: string }>(
        "SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1",
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(linkedIdentity.rows, [], "the rejected Google identity must remain unlinked");

      const afterReferrals = await pool.query<ReferralSnapshot>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      assert.deepEqual(afterReferrals.rows, beforeReferrals.rows, "the rejected link must not create a referral");
      const afterLedger = await pool.query<LedgerSnapshot>(
        `SELECT amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      assert.deepEqual(afterLedger.rows, beforeLedger.rows, "the rejected link must not change wallet rewards");
      const afterReferrer = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [referrerId],
      );
      assert.deepEqual(afterReferrer.rows, beforeReferrer.rows, "the rejected link must not reward the referrer");

      const oldWallet = await readWalletHistory(origin, oldToken);
      assert.equal(oldWallet.status, 401, "the earlier password session must be replaced");
      const newWallet = await readWalletHistory(origin, newToken);
      assert.equal(newWallet.status, 200, "the committed password session should remain usable");
    });
  } finally {
    if (transactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      transactionOpen = false;
    }
    if (signInPromise) await signInPromise.catch(() => undefined);
    if (linkPromise) await linkPromise.catch(() => undefined);
    blocker?.release();
    if (accountId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [accountId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});

test("a PostgreSQL failure after Google linking keeps the password account and session unchanged", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  let accountId: string | undefined;

  try {
    await withServer(async (origin) => {
      const registration = await postJson(origin, "/daily007/v2/auth/register", {
        name: "Google Link Player",
        email: ACCOUNT_EMAIL,
        password: ACCOUNT_PASSWORD,
      });
      assert.equal(registration.status, 201, "password account should be created");
      accountId = String((registration.body.account as Record<string, unknown>).id);

      const passwordToken = await login(origin, "198.51.100.3");
      const beforeAccount = await pool.query<{
        id: string;
        auth_version: number;
        clerk_user_id: string | null;
        wallet_coins: number;
        password_salt: string;
        password_hash: string;
      }>(
        `SELECT id, auth_version, clerk_user_id, wallet_coins, password_salt, password_hash
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.equal(beforeAccount.rows.length, 1);
      assert.equal(beforeAccount.rows[0]?.clerk_user_id, null);
      const beforeLedger = await pool.query<{
        id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string | null;
      }>(
        `SELECT id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      const walletBefore = await readWalletHistory(origin, passwordToken);
      assert.equal(walletBefore.status, 200, "the password session should work before linking");

      await pool.query("DROP TRIGGER IF EXISTS daily007_test_fail_google_link_after_update ON daily007_v2_users");
      await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_google_link_after_update()");
      await pool.query("DROP SEQUENCE IF EXISTS daily007_test_google_link_failure_seq");
      await pool.query("CREATE SEQUENCE daily007_test_google_link_failure_seq START 1");
      await pool.query(`
        CREATE FUNCTION daily007_test_fail_google_link_after_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF OLD.clerk_user_id IS NULL
             AND NEW.clerk_user_id = '${GOOGLE_CLERK_USER_ID}' THEN
            PERFORM nextval('daily007_test_google_link_failure_seq');
            RAISE EXCEPTION 'Injected failure after Google account link update';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await pool.query(`
        CREATE TRIGGER daily007_test_fail_google_link_after_update
        AFTER UPDATE OF clerk_user_id ON daily007_v2_users
        FOR EACH ROW
        EXECUTE FUNCTION daily007_test_fail_google_link_after_update()
      `);

      const linkAttempt = await postJson(origin, "/auth/google", { referralCode: null }, {
        authorization: "Bearer mocked-clerk-session",
        "x-mock-clerk-user-id": GOOGLE_CLERK_USER_ID,
        "X-Daily007-Token": passwordToken,
      });
      assert.equal(linkAttempt.status, 500, "the injected post-link PostgreSQL failure should reject linking");

      const failureAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_google_link_failure_seq",
      );
      assert.equal(failureAttempts.rows[0]?.last_value, "1",
        "the injected failure must run after the Google identity was assigned in the transaction");

      const afterAccount = await pool.query<{
        id: string;
        auth_version: number;
        clerk_user_id: string | null;
        wallet_coins: number;
        password_salt: string;
        password_hash: string;
      }>(
        `SELECT id, auth_version, clerk_user_id, wallet_coins, password_salt, password_hash
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.deepEqual(
        afterAccount.rows,
        beforeAccount.rows,
        "the failed transaction must restore the unlinked account and its original session version",
      );
      const linkedIdentity = await pool.query<{ id: string }>(
        "SELECT id FROM daily007_v2_users WHERE clerk_user_id = $1",
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(linkedIdentity.rows, [], "the failed link must not reserve the Google identity");

      const afterLedger = await pool.query<{
        id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string | null;
      }>(
        `SELECT id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [accountId],
      );
      assert.deepEqual(afterLedger.rows, beforeLedger.rows, "the failed link must leave wallet ledger data unchanged");

      const walletAfter = await readWalletHistory(origin, passwordToken);
      assert.equal(walletAfter.status, 200, "the pre-link password session must still authorize Wallet");
      assert.deepEqual(
        walletAfter.history,
        walletBefore.history,
        "the failed link must leave the existing password session's Wallet history unchanged",
      );
    });
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_fail_google_link_after_update ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_google_link_after_update()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_google_link_failure_seq");
    if (accountId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [accountId]);
    resetMockGoogleUser();
  }
});
