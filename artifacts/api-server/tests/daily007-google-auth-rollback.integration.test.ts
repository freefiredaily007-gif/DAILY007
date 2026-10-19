import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import type { User } from "@clerk/express";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  referralCodeForUserId,
  shortReferralCodeForUserId,
} from "../src/lib/daily007-compat-extra-validation";
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

const SECOND_VERIFIED_GOOGLE_USER_WITH_SHARED_EMAIL = {
  id: SECOND_GOOGLE_CLERK_USER_ID,
  firstName: "Second",
  lastName: "Postgres",
  emailAddresses: [{
    emailAddress: GOOGLE_EMAIL,
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: GOOGLE_EMAIL,
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
  daily007Token?: string,
): Promise<JsonResult> {
  const response = await fetch(`${origin}/auth/google`, {
    method: "POST",
    headers: {
      authorization: "Bearer mocked-clerk-session",
      "content-type": "application/json",
      "x-mock-clerk-user-id": clerkUserId,
      ...(daily007Token ? { "x-daily007-token": daily007Token } : {}),
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

async function waitForBlockedBackends(
  blocker: Awaited<ReturnType<typeof pool.connect>>,
  queryPattern: string,
  expectedCount: number,
  description: string,
  timeoutMs = 5_000,
): Promise<number[]> {
  assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the blocker PID");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await blocker.query("SELECT pg_stat_clear_snapshot()");
    const result = await blocker.query<{ pid: number }>(
      `SELECT waiting.pid
         FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> $1
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $2
          AND $1 = ANY(pg_blocking_pids(waiting.pid))
        ORDER BY waiting.query_start
        LIMIT $3`,
      [blocker.processID, queryPattern, expectedCount],
    );
    if (result.rows.length >= expectedCount) {
      return result.rows.map(({ pid }) => pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

test("Google linking preserves a password account and its PostgreSQL Wallet history", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const accountId = randomUUID();
  const firstLedgerId = randomUUID();
  const secondLedgerId = randomUUID();
  const localSessionVersion = 4;

  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, wallet_coins, auth_version)
     VALUES ($1, 'Existing Wallet Owner', $2, 'existing-salt', 'existing-hash', 37, $3)`,
    [accountId, GOOGLE_EMAIL, localSessionVersion],
  );
  await pool.query(
    `INSERT INTO daily007_v2_wallet_ledger
       (id, user_id, amount, balance_after, reason, idempotency_key, details, created_at)
     VALUES
       ($1, $3, 50, 50, 'Wallet Top-up', $4, '{"description":"Original top-up"}', '2026-01-15T10:00:00.000Z'),
       ($2, $3, -13, 37, 'Match Entry', $5, '{"description":"Original match entry"}', '2026-02-20T12:30:00.000Z')`,
    [
      firstLedgerId,
      secondLedgerId,
      accountId,
      `test-wallet-top-up:${accountId}`,
      `test-match-entry:${accountId}`,
    ],
  );
  const localToken = makeToken(accountId, localSessionVersion);
  assert.ok(localToken, "the test account should receive a valid Daily007 session token");

  try {
    await withServer(async (origin) => {
      const accountBefore = await pool.query(
        `SELECT id, name, email, password_salt, password_hash, wallet_coins,
                auth_version, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      const ledgerBefore = await pool.query(
        `SELECT id, user_id, amount, balance_after, reason, idempotency_key, details,
                created_at::text AS created_at
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at ASC, id ASC`,
        [accountId],
      );
      const walletBeforeResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${localToken}` },
      });
      assert.equal(walletBeforeResponse.status, 200,
        "the seeded Daily007 session should read the original Wallet history");
      const walletBefore = await walletBeforeResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletBefore.map(({ id, amount, balanceAfter, reason, details, description }) => ({
          id,
          amount,
          balanceAfter,
          reason,
          details,
          description,
        })),
        [
          {
            id: secondLedgerId,
            amount: -13,
            balanceAfter: 37,
            reason: "Match Entry",
            details: { description: "Original match entry" },
            description: "Original match entry",
          },
          {
            id: firstLedgerId,
            amount: 50,
            balanceAfter: 50,
            reason: "Wallet Top-up",
            details: { description: "Original top-up" },
            description: "Original top-up",
          },
        ],
        "the starting Wallet history should contain both seeded entries in reverse chronological order",
      );

      const linked = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, null, localToken);
      assert.equal(linked.status, 200, "a valid password-account session should authorize Google linking");
      assert.equal(linked.body.id, accountId, "linking must return the existing Daily007 account");
      assert.equal(linked.body.email, GOOGLE_EMAIL);
      assert.equal(linked.body.coins, 37, "linking must preserve the account's wallet balance");
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.token, localToken, "linking must preserve the existing Daily007 session");

      const accountAfter = await pool.query(
        `SELECT id, name, email, password_salt, password_hash, wallet_coins,
                auth_version, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1`,
        [accountId],
      );
      assert.deepEqual(accountAfter.rows, [{
        ...accountBefore.rows[0],
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      }], "only the Google identity should be added to the original account");

      const linkedIdentity = await pool.query(
        `SELECT id, clerk_user_id
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(linkedIdentity.rows, [{
        id: accountId,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      }], "the verified Google identity must be linked to exactly one account");

      const ledgerAfter = await pool.query(
        `SELECT id, user_id, amount, balance_after, reason, idempotency_key, details,
                created_at::text AS created_at
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at ASC, id ASC`,
        [accountId],
      );
      assert.deepEqual(ledgerAfter.rows, ledgerBefore.rows,
        "Google linking must not insert, delete, or alter any wallet-ledger entry");

      const walletAfterResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${localToken}` },
      });
      assert.equal(walletAfterResponse.status, 200);
      const walletAfter = await walletAfterResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(walletAfter, walletBefore,
        "the authenticated Wallet history response must remain unchanged");
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [accountId]);
    resetMockGoogleUser();
  }
});


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

test("Google signup retries a colliding short referral code in PostgreSQL", async () => {
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);
  const googleAccountId = "00000000-0000-4000-8000-000000001229";
  const collisionOwnerId = "00000000-0000-4000-8000-000000001228";
  const firstCandidate = shortReferralCodeForUserId(googleAccountId, 0);
  const fallbackCandidate = shortReferralCodeForUserId(googleAccountId, 1);
  assert.notEqual(firstCandidate, fallbackCandidate);

  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Existing Short-Code Owner', $2, 'owner-salt', 'owner-hash')`,
    [collisionOwnerId, `short-code-owner-${collisionOwnerId}@example.test`],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
    [collisionOwnerId, firstCandidate],
  );

  try {
    await pool.query(`
      CREATE FUNCTION daily007_test_force_google_signup_user_id()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.clerk_user_id = '${GOOGLE_CLERK_USER_ID}' THEN
          NEW.id := '${googleAccountId}'::uuid;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_force_google_signup_user_id
      BEFORE INSERT ON daily007_v2_users
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_force_google_signup_user_id()
    `);

    await withServer(async (origin) => {
      const signup = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
      assert.equal(signup.status, 201, "Google signup should succeed after the first short code collides");
      assert.equal(signup.body.id, googleAccountId);
      assert.equal(signup.body.coins, 10, "the new account should receive its one signup reward");

      const ownerCode = await pool.query<{ user_id: string; code: string }>(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          WHERE user_id = $1`,
        [collisionOwnerId],
      );
      assert.deepEqual(
        ownerCode.rows,
        [{ user_id: collisionOwnerId, code: firstCandidate }],
        "the existing owner must keep the first candidate",
      );

      const newAccount = await pool.query<{
        id: string;
        clerk_user_id: string;
        wallet_coins: number;
      }>(
        `SELECT id, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(
        newAccount.rows,
        [{ id: googleAccountId, clerk_user_id: GOOGLE_CLERK_USER_ID, wallet_coins: 10 }],
        "exactly one Google-linked account should persist with its signup reward",
      );

      const savedShortCodes = await pool.query<{ user_id: string; code: string }>(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [[collisionOwnerId, googleAccountId]],
      );
      assert.deepEqual(
        savedShortCodes.rows,
        [
          { user_id: collisionOwnerId, code: firstCandidate },
          { user_id: googleAccountId, code: fallbackCandidate },
        ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
        "PostgreSQL should retain the original owner and save the next deterministic candidate",
      );

      // The fixture injects a one-shot failure for the first referral reward; keep this success-path
      // case focused on redemption while retaining the failure hook for other rollback tests.
      await resetReferralRewardFailureTrigger("Welcome Signup Bonus");
      const referredSignup = await googleSignIn(
        origin,
        SECOND_GOOGLE_CLERK_USER_ID,
        fallbackCandidate,
      );
      assert.equal(referredSignup.status, 201, "a second Google account should redeem the fallback code");
      assert.equal(referredSignup.body.email, SECOND_GOOGLE_EMAIL);
      assert.equal(referredSignup.body.coins, 10, "the referred account should receive exactly 10 signup coins");
      assert.equal(typeof referredSignup.body.id, "string");
      const referredAccountId = String(referredSignup.body.id);

      const referralRelationship = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          WHERE referred_user_id = $1`,
        [referredAccountId],
      );
      assert.deepEqual(
        referralRelationship.rows,
        [{
          referrer_user_id: googleAccountId,
          referred_user_id: referredAccountId,
          code: fallbackCandidate,
        }],
        "PostgreSQL should link the second Google account to the owner of the fallback code",
      );

      const referredAccount = await pool.query<{
        id: string;
        clerk_user_id: string;
        wallet_coins: number;
      }>(
        `SELECT id, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [SECOND_GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(
        referredAccount.rows,
        [{
          id: referredAccountId,
          clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
          wallet_coins: 10,
        }],
        "the second Google account should persist with the one-time signup reward balance",
      );

      const referredSignupRewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
            AND reason IN ('Welcome Signup Bonus', 'Referral Signup Bonus')`,
        [referredAccountId],
      );
      assert.deepEqual(
        referredSignupRewards.rows,
        [{
          user_id: referredAccountId,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
          idempotency_key: `daily007-referral-signup:${referredAccountId}`,
        }],
        "the referral relationship should produce exactly one 10-coin signup reward",
      );

      const signupRewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
            AND reason IN ('Welcome Signup Bonus', 'Referral Signup Bonus')`,
        [googleAccountId],
      );
      assert.deepEqual(
        signupRewards.rows,
        [{
          user_id: googleAccountId,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
          idempotency_key: `daily007-welcome-signup:${googleAccountId}`,
        }],
        "the Google account should retain exactly one signup reward",
      );
    });
  } finally {
    await resetReferralRewardFailureTrigger();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_force_google_signup_user_id ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_force_google_signup_user_id()");
    await pool.query(
      `DELETE FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
           OR clerk_user_id = ANY($2::text[])`,
      [
        [collisionOwnerId, googleAccountId],
        [GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID],
      ],
    );
    resetMockGoogleUser();
  }
});

test("concurrent Google signups keep unique fallback codes and one signup reward each", async () => {
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);
  const firstAccountId = "00000000-0000-4000-8000-00000000006e";
  const secondAccountId = "00000000-0000-4000-8000-0000000001bc";
  const collisionOwnerId = randomUUID();
  const firstCandidate = shortReferralCodeForUserId(firstAccountId, 0);
  const secondFirstCandidate = shortReferralCodeForUserId(secondAccountId, 0);
  const firstFallback = shortReferralCodeForUserId(firstAccountId, 1);
  const secondFallback = shortReferralCodeForUserId(secondAccountId, 1);
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseTransactionOpen = false;
  let firstSignIn: Promise<JsonResult> | undefined;
  let secondSignIn: Promise<JsonResult> | undefined;

  assert.equal(firstCandidate, secondFirstCandidate,
    "the deterministic account IDs must share their first short-code candidate");
  assert.notEqual(firstFallback, secondFallback,
    "the fallback candidates must be distinct");
  assert.notEqual(firstFallback, firstCandidate);
  assert.notEqual(secondFallback, secondFirstCandidate);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Existing Referral-Code Owner', $2, 'owner-salt', 'owner-hash')`,
      [collisionOwnerId, `concurrent-short-code-owner-${collisionOwnerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [collisionOwnerId, REFERRAL_CODE],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
      [collisionOwnerId, firstCandidate],
    );
    await resetReferralRewardFailureTrigger("Welcome Signup Bonus");

    await pool.query(`
      CREATE FUNCTION daily007_test_assign_concurrent_google_signup_ids()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.clerk_user_id = '${GOOGLE_CLERK_USER_ID}' THEN
          NEW.id := '${firstAccountId}'::uuid;
        ELSIF NEW.clerk_user_id = '${SECOND_GOOGLE_CLERK_USER_ID}' THEN
          NEW.id := '${secondAccountId}'::uuid;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_assign_concurrent_google_signup_ids
      BEFORE INSERT ON daily007_v2_users
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_assign_concurrent_google_signup_ids()
    `);
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_shared_first_short_code()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.code = '${firstCandidate}' THEN
          PERFORM pg_advisory_xact_lock(743003, 3);
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_shared_first_short_code
      BEFORE INSERT ON daily007_v2_referral_short_codes
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_pause_shared_first_short_code()
    `);

    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID),
        "PostgreSQL should expose the concurrent-candidate barrier PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 3)");

      try {
        firstSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID);
        secondSignIn = googleSignIn(origin, SECOND_GOOGLE_CLERK_USER_ID);
        const queuedSignups = await waitForBlockedBackends(
          blocker,
          "%INSERT INTO daily007_v2_referral_short_codes%",
          2,
          "both Google signups to reach their shared first short-code candidate",
        );
        assert.equal(new Set(queuedSignups).size, 2,
          "the shared candidate attempt should be reached by two separate signup transactions");

        await blocker.query("COMMIT");
        pauseTransactionOpen = false;
        const [firstResult, secondResult] = await Promise.all([firstSignIn, secondSignIn]);
        assert.deepEqual(
          [firstResult.status, secondResult.status],
          [201, 201],
          "both concurrent Google signups should succeed after reserving fallback codes",
        );
        assert.equal(firstResult.body.id, firstAccountId);
        assert.equal(secondResult.body.id, secondAccountId);
        assert.equal(firstResult.body.email, GOOGLE_EMAIL);
        assert.equal(secondResult.body.email, SECOND_GOOGLE_EMAIL);
        assert.equal(firstResult.body.coins, 10);
        assert.equal(secondResult.body.coins, 10);

        const linkedAccounts = await pool.query<{
          id: string;
          email: string;
          clerk_user_id: string;
          wallet_coins: number;
        }>(
          `SELECT id, email, clerk_user_id, wallet_coins
             FROM daily007_v2_users
            WHERE clerk_user_id = ANY($1::text[])
            ORDER BY clerk_user_id`,
          [[GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
        );
        assert.equal(linkedAccounts.rows.length, 2,
          "each Google identity should link to exactly one new Daily007 account");
        const accountsByClerkId = new Map(
          linkedAccounts.rows.map((account) => [account.clerk_user_id, account]),
        );
        assert.deepEqual(accountsByClerkId.get(GOOGLE_CLERK_USER_ID), {
          id: firstAccountId,
          email: GOOGLE_EMAIL,
          clerk_user_id: GOOGLE_CLERK_USER_ID,
          wallet_coins: 10,
        });
        assert.deepEqual(accountsByClerkId.get(SECOND_GOOGLE_CLERK_USER_ID), {
          id: secondAccountId,
          email: SECOND_GOOGLE_EMAIL,
          clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
          wallet_coins: 10,
        });

        const savedCodes = await pool.query<{ user_id: string; code: string }>(
          `SELECT user_id, code
             FROM daily007_v2_referral_short_codes
            WHERE user_id = ANY($1::uuid[])
            ORDER BY user_id`,
          [[collisionOwnerId, firstAccountId, secondAccountId]],
        );
        assert.deepEqual(
          savedCodes.rows,
          [
            { user_id: collisionOwnerId, code: firstCandidate },
            { user_id: firstAccountId, code: firstFallback },
            { user_id: secondAccountId, code: secondFallback },
          ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
          "the existing owner should keep the shared code while each signup reserves its unique fallback",
        );

        const rewards = await pool.query<{
          user_id: string;
          amount: number;
          balance_after: number;
          reason: string;
          idempotency_key: string;
        }>(
          `SELECT user_id, amount, balance_after, reason, idempotency_key
             FROM daily007_v2_wallet_ledger
            WHERE user_id = ANY($1::uuid[])
            ORDER BY user_id`,
          [[firstAccountId, secondAccountId]],
        );
        assert.deepEqual(
          rewards.rows,
          [
            {
              user_id: firstAccountId,
              amount: 10,
              balance_after: 10,
              reason: "Referral Signup Bonus",
              idempotency_key: `daily007-referral-signup:${firstAccountId}`,
            },
            {
              user_id: secondAccountId,
              amount: 10,
              balance_after: 10,
              reason: "Referral Signup Bonus",
              idempotency_key: `daily007-referral-signup:${secondAccountId}`,
            },
          ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
          "each account should retain exactly one 10-coin signup reward",
        );
      } finally {
        if (pauseTransactionOpen && blocker) {
          await blocker.query("ROLLBACK").catch(() => undefined);
          pauseTransactionOpen = false;
        }
        await Promise.all([
          firstSignIn?.catch(() => undefined),
          secondSignIn?.catch(() => undefined),
        ]);
      }
    });
  } finally {
    if (pauseTransactionOpen && blocker) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      pauseTransactionOpen = false;
    }
    blocker?.release();
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_shared_first_short_code ON daily007_v2_referral_short_codes",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_shared_first_short_code()");
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_assign_concurrent_google_signup_ids ON daily007_v2_users",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_assign_concurrent_google_signup_ids()");
    await resetReferralRewardFailureTrigger();
    await pool.query(
      `DELETE FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
           OR clerk_user_id = ANY($2::text[])`,
      [
        [collisionOwnerId, firstAccountId, secondAccountId],
        [GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID],
      ],
    );
    resetMockGoogleUser();
  }
});

test("Google signup leaves no partial account when every short referral-code candidate is taken", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const googleAccountId = "00000000-0000-4000-8000-000000001708";
  const ownerIds = Array.from({ length: 500 }, () => randomUUID());
  const candidateAttempts = Array.from(
    { length: 500 },
    (_, attempt) => shortReferralCodeForUserId(googleAccountId, attempt),
  );
  const occupiedCandidates = [...new Set(candidateAttempts)];

  assert.equal(candidateAttempts.length, 500,
    "the test should occupy every candidate the allocator tries");
  assert.ok(occupiedCandidates.length > 0);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash)
       SELECT owners.id, 'Existing Candidate Owner', owners.email, 'owner-salt', 'owner-hash'
         FROM unnest($1::uuid[], $2::text[]) AS owners(id, email)`,
      [
        ownerIds,
        ownerIds.map((ownerId) => `exhausted-code-owner-${ownerId}@example.test`),
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_referral_short_codes (user_id, code)
       SELECT owners.user_id, owners.code
         FROM unnest($1::uuid[], $2::text[]) AS owners(user_id, code)`,
      [ownerIds.slice(0, occupiedCandidates.length), occupiedCandidates],
    );
    const ownerCodesBefore = await pool.query<{ user_id: string; code: string }>(
      `SELECT user_id, code
         FROM daily007_v2_referral_short_codes
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id`,
      [ownerIds],
    );
    assert.equal(ownerCodesBefore.rows.length, occupiedCandidates.length,
      "each distinct attempted candidate should already have an owner");
    assert.deepEqual(
      new Set(ownerCodesBefore.rows.map(({ code }) => code)),
      new Set(occupiedCandidates),
      "the seeded owners should cover all 500 candidate attempts",
    );

    await pool.query(`
      CREATE FUNCTION daily007_test_force_exhausted_google_signup_id()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.clerk_user_id = '${GOOGLE_CLERK_USER_ID}' THEN
          NEW.id := '${googleAccountId}'::uuid;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_force_exhausted_google_signup_id
      BEFORE INSERT ON daily007_v2_users
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_force_exhausted_google_signup_id()
    `);

    await withServer(async (origin) => {
      const signup = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
      assert.equal(signup.status, 500,
        "Google signup should fail once all deterministic short-code candidates are occupied");
      assert.equal(signup.body.error, "Test server encountered an unexpected error.");

      const account = await pool.query<{
        id: string;
        email: string;
        clerk_user_id: string | null;
        wallet_coins: number;
      }>(
        `SELECT id, email, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1 OR clerk_user_id = $2 OR email = $3`,
        [googleAccountId, GOOGLE_CLERK_USER_ID, GOOGLE_EMAIL],
      );
      assert.deepEqual(account.rows, [],
        "failed signup must leave no account or Google identity link");

      const legacyCodes = await pool.query<{ user_id: string; code: string }>(
        "SELECT user_id, code FROM daily007_v2_referral_codes WHERE user_id = $1",
        [googleAccountId],
      );
      assert.deepEqual(legacyCodes.rows, [],
        "failed signup must not leave its long-form referral code");

      const shortCodes = await pool.query<{ user_id: string; code: string }>(
        "SELECT user_id, code FROM daily007_v2_referral_short_codes WHERE user_id = $1",
        [googleAccountId],
      );
      assert.deepEqual(shortCodes.rows, [],
        "failed signup must not leave a short-code reservation");

      const rewards = await pool.query<{ user_id: string; amount: number; reason: string }>(
        `SELECT user_id, amount, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1`,
        [googleAccountId],
      );
      assert.deepEqual(rewards.rows, [],
        "failed signup must not leave a partial wallet reward");

      const ownerCodesAfter = await pool.query<{ user_id: string; code: string }>(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [ownerIds],
      );
      assert.deepEqual(ownerCodesAfter.rows, ownerCodesBefore.rows,
        "all existing owners must keep their original short codes after rollback");
    });
  } finally {
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_force_exhausted_google_signup_id ON daily007_v2_users",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_force_exhausted_google_signup_id()");
    await pool.query(
      `DELETE FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
           OR id = $2
           OR clerk_user_id = $3`,
      [ownerIds, googleAccountId, GOOGLE_CLERK_USER_ID],
    );
    resetMockGoogleUser();
  }
});

test("a failed Google signup does not consume a fallback short code before retry in PostgreSQL", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const googleAccountId = randomUUID();
  const collisionOwnerId = randomUUID();
  const firstCandidate = shortReferralCodeForUserId(googleAccountId, 0);
  const fallbackCandidate = shortReferralCodeForUserId(googleAccountId, 1);
  assert.notEqual(firstCandidate, fallbackCandidate);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Existing Short-Code Owner', $2, 'owner-salt', 'owner-hash')`,
      [collisionOwnerId, `failed-signup-code-owner-${collisionOwnerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
      [collisionOwnerId, firstCandidate],
    );
    await resetReferralRewardFailureTrigger("Welcome Signup Bonus");

    await pool.query(`
      CREATE FUNCTION daily007_test_force_google_signup_user_id()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.clerk_user_id = '${GOOGLE_CLERK_USER_ID}' THEN
          NEW.id := '${googleAccountId}'::uuid;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_force_google_signup_user_id
      BEFORE INSERT ON daily007_v2_users
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_force_google_signup_user_id()
    `);

    await withServer(async (origin) => {
      const failedSignup = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
      assert.equal(failedSignup.status, 500, "the injected welcome-reward write should fail the signup");

      const failedRewardAttempts = await pool.query<{
        last_value: string;
        is_called: boolean;
      }>(
        "SELECT last_value::text, is_called FROM daily007_test_referral_reward_failure_seq",
      );
      assert.deepEqual(
        failedRewardAttempts.rows,
        [{ last_value: "1", is_called: true }],
        "the first signup should reach the one-shot reward failure trigger",
      );

      const failedAccount = await pool.query<{ id: string }>(
        `SELECT id
           FROM daily007_v2_users
          WHERE id = $1 OR clerk_user_id = $2 OR email = $3`,
        [googleAccountId, GOOGLE_CLERK_USER_ID, GOOGLE_EMAIL],
      );
      assert.deepEqual(failedAccount.rows, [], "the failed signup must leave no account behind");

      const failedCodes = await pool.query<{ code: string }>(
        `SELECT code FROM daily007_v2_referral_short_codes WHERE user_id = $1
         UNION ALL
         SELECT code FROM daily007_v2_referral_codes WHERE user_id = $1`,
        [googleAccountId],
      );
      assert.deepEqual(failedCodes.rows, [], "the failed signup must leave no referral code behind");

      const ownerCodeAfterFailure = await pool.query<{ user_id: string; code: string }>(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          WHERE code = $1`,
        [firstCandidate],
      );
      assert.deepEqual(
        ownerCodeAfterFailure.rows,
        [{ user_id: collisionOwnerId, code: firstCandidate }],
        "the collision owner must retain the first candidate after rollback",
      );

      const retry = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, null);
      assert.equal(retry.status, 201, "the same Google identity should succeed on retry");
      assert.equal(retry.body.id, googleAccountId);
      assert.equal(retry.body.coins, 10, "the successful retry should award exactly 10 coins");

      const accountAfterRetry = await pool.query<{
        id: string;
        clerk_user_id: string;
        email: string;
        wallet_coins: number;
      }>(
        `SELECT id, clerk_user_id, email, wallet_coins
           FROM daily007_v2_users
          WHERE id = $1`,
        [googleAccountId],
      );
      assert.deepEqual(
        accountAfterRetry.rows,
        [{
          id: googleAccountId,
          clerk_user_id: GOOGLE_CLERK_USER_ID,
          email: GOOGLE_EMAIL,
          wallet_coins: 10,
        }],
        "the retry should create one account with its one-time signup reward",
      );

      const codeAfterRetry = await pool.query<{ user_id: string; code: string }>(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          WHERE user_id = $1`,
        [googleAccountId],
      );
      assert.deepEqual(
        codeAfterRetry.rows,
        [{ user_id: googleAccountId, code: fallbackCandidate }],
        "the retry should reserve the same next candidate after the collision",
      );

      const rewardsAfterRetry = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
            AND reason IN ('Welcome Signup Bonus', 'Referral Signup Bonus')`,
        [googleAccountId],
      );
      assert.deepEqual(
        rewardsAfterRetry.rows,
        [{
          user_id: googleAccountId,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
          idempotency_key: `daily007-welcome-signup:${googleAccountId}`,
        }],
        "the successful retry should leave exactly one signup reward",
      );

      const rewardAttemptsAfterRetry = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(
        rewardAttemptsAfterRetry.rows[0]?.last_value,
        "2",
        "the retry should pass the one-shot failure and reach the reward ledger",
      );
    });
  } finally {
    await resetReferralRewardFailureTrigger();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_force_google_signup_user_id ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_force_google_signup_user_id()");
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[collisionOwnerId, googleAccountId]],
    );
    resetMockGoogleUser();
  }
});

test("Google signup cannot take over a password account with the verified email", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const passwordUserId = randomUUID();
  const referrerId = randomUUID();
  const passwordReferralCode = "PASS1";

  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, referral_code, wallet_coins, auth_version)
     VALUES ($1, 'Existing Password Owner', $2, 'existing-salt', 'existing-hash', $3, 37, 4)`,
    [passwordUserId, GOOGLE_EMAIL, passwordReferralCode],
  );
  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Existing Referrer', $2, 'referrer-salt', 'referrer-hash')`,
    [referrerId, `referrer-${referrerId}@example.test`],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
    [passwordUserId, passwordReferralCode],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
    [referrerId, REFERRAL_CODE],
  );
  await pool.query(
    `INSERT INTO daily007_v2_referrals (referrer_user_id, referred_user_id, code)
     VALUES ($1, $2, $3)`,
    [referrerId, passwordUserId, REFERRAL_CODE],
  );
  await pool.query(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, idempotency_key)
     VALUES ($1, 37, 37, 'Existing Wallet Balance', $2)`,
    [passwordUserId, `test-password-wallet:${passwordUserId}`],
  );

  try {
    await withServer(async (origin) => {
      const accountBefore = await pool.query(
        `SELECT id, name, email, password_salt, password_hash, referral_code,
                wallet_coins, auth_version, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1`,
        [passwordUserId],
      );
      const referralsBefore = await pool.query(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      const referralCodesBefore = await pool.query(
        `SELECT user_id, code
           FROM daily007_v2_referral_codes
          ORDER BY user_id`,
      );
      const shortCodesBefore = await pool.query(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          ORDER BY user_id`,
      );
      const walletBefore = await pool.query(
        `SELECT id, user_id, amount, balance_after, reason, idempotency_key, details
           FROM daily007_v2_wallet_ledger
          ORDER BY id`,
      );

      const rejected = await googleSignIn(origin);
      assert.equal(rejected.status, 409);
      assert.match(String(rejected.body.error), /already uses this email.*sign in with your password/i);

      const accountAfter = await pool.query(
        `SELECT id, name, email, password_salt, password_hash, referral_code,
                wallet_coins, auth_version, clerk_user_id
           FROM daily007_v2_users
          WHERE id = $1`,
        [passwordUserId],
      );
      assert.deepEqual(accountAfter.rows, accountBefore.rows,
        "the existing password account and its session version must remain unchanged");

      const googleIdentity = await pool.query(
        `SELECT id, email, clerk_user_id
           FROM daily007_v2_users
          WHERE clerk_user_id = $1`,
        [GOOGLE_CLERK_USER_ID],
      );
      assert.deepEqual(googleIdentity.rows, [],
        "the rejected signup must not attach the Google identity to any account");

      const accountCount = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_users",
      );
      assert.equal(accountCount.rows[0]?.count, 2,
        "the rejected signup must not create a second account for the verified email");

      const referralsAfter = await pool.query(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      assert.deepEqual(referralsAfter.rows, referralsBefore.rows,
        "the rejected signup must not change existing referrals or create a new one");

      const referralCodesAfter = await pool.query(
        `SELECT user_id, code
           FROM daily007_v2_referral_codes
          ORDER BY user_id`,
      );
      assert.deepEqual(referralCodesAfter.rows, referralCodesBefore.rows,
        "the rejected signup must not change existing referral codes");

      const shortCodesAfter = await pool.query(
        `SELECT user_id, code
           FROM daily007_v2_referral_short_codes
          ORDER BY user_id`,
      );
      assert.deepEqual(shortCodesAfter.rows, shortCodesBefore.rows,
        "the rejected signup must not create or change short referral codes");

      const walletAfter = await pool.query(
        `SELECT id, user_id, amount, balance_after, reason, idempotency_key, details
           FROM daily007_v2_wallet_ledger
          ORDER BY id`,
      );
      assert.deepEqual(walletAfter.rows, walletBefore.rows,
        "the rejected signup must leave the wallet ledger unchanged");
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[passwordUserId, referrerId]],
    );
    resetMockGoogleUser();
  }
});

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

test("Google signup accepts lowercase five-letter referral codes with surrounding whitespace in PostgreSQL", async () => {
  await pool.query(
    "DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger",
  );
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  const referralCodeInput = `  ${REFERRAL_CODE.toLowerCase()}  `;

  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Lowercase Referral Owner', $2, 'owner-salt', 'owner-hash')`,
    [referrerId, `lowercase-referrer-${referrerId}@example.test`],
  );
  await pool.query(
    "INSERT INTO daily007_v2_referral_short_codes (user_id, code) VALUES ($1, $2)",
    [referrerId, REFERRAL_CODE],
  );

  try {
    await withServer(async (origin) => {
      const signup = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, referralCodeInput);
      assert.equal(signup.status, 201, "a lowercase registered short code should be accepted");
      assert.equal(signup.body.coins, 10);
      assert.equal(typeof signup.body.token, "string");

      const accountId = String(signup.body.id);
      const linkedAccount = await pool.query<{
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
      assert.deepEqual(
        linkedAccount.rows,
        [{
          id: accountId,
          email: GOOGLE_EMAIL,
          clerk_user_id: GOOGLE_CLERK_USER_ID,
          wallet_coins: 10,
        }],
        "the signup should persist exactly one linked account with a 10-coin balance",
      );

      const referrals = await pool.query<{
        id: string;
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT id, referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          WHERE referred_user_id = $1`,
        [accountId],
      );
      assert.deepEqual(
        referrals.rows.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{ referrer_user_id: referrerId, referred_user_id: accountId, code: REFERRAL_CODE }],
        "PostgreSQL should persist the canonical code against the correct referrer",
      );
      const [referral] = referrals.rows;
      assert.ok(referral, "the normalized code should create one referral relationship");

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
        details: Record<string, unknown>;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key, details
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1`,
        [accountId],
      );
      assert.deepEqual(
        rewards.rows,
        [{
          user_id: accountId,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
          idempotency_key: `daily007-referral-signup:${accountId}`,
          details: {
            referrerUserId: referrerId,
            referralId: referral.id,
            referralCode: REFERRAL_CODE,
          },
        }],
        "the account should receive one referral reward with the canonical code and no welcome bonus",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletHistory.length, 1, "Wallet history should contain one signup row");
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
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

test("Google signup accepts lowercase long-form legacy referral codes in PostgreSQL", async () => {
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  const referrerId = randomUUID();
  const legacyReferralCode = referralCodeForUserId(referrerId);
  const referralCodeInput = `  ${legacyReferralCode.toLowerCase()}  `;
  assert.ok(legacyReferralCode.length > 5, "the registered legacy code should be long-form");

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Long-Form Referral Owner', $2, 'owner-salt', 'owner-hash')`,
      [referrerId, `legacy-referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, legacyReferralCode],
    );
    await resetReferralRewardFailureTrigger("Welcome Signup Bonus");

    await withServer(async (origin) => {
      const signup = await googleSignIn(origin, GOOGLE_CLERK_USER_ID, referralCodeInput);
      assert.equal(signup.status, 201, "a lowercase long-form legacy code should be accepted");
      assert.equal(signup.body.coins, 10);
      assert.equal(typeof signup.body.token, "string");
      assert.equal(typeof signup.body.id, "string");
      const accountId = String(signup.body.id);

      const shortCodeMatches = await pool.query<{ user_id: string }>(
        "SELECT user_id FROM daily007_v2_referral_short_codes WHERE code = $1",
        [legacyReferralCode],
      );
      assert.deepEqual(
        shortCodeMatches.rows,
        [],
        "the test code must resolve through the separate legacy-code table",
      );

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          WHERE referred_user_id = $1`,
        [accountId],
      );
      assert.deepEqual(
        referrals.rows,
        [{
          referrer_user_id: referrerId,
          referred_user_id: accountId,
          code: legacyReferralCode,
        }],
        "PostgreSQL should store the canonical legacy code and correct referrer relationship",
      );

      const signupRewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
            AND reason IN ('Welcome Signup Bonus', 'Referral Signup Bonus')`,
        [accountId],
      );
      assert.deepEqual(
        signupRewards.rows,
        [{
          user_id: accountId,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
          idempotency_key: `daily007-referral-signup:${accountId}`,
        }],
        "the referred account should receive exactly one 10-coin signup reward",
      );
    });
  } finally {
    await resetReferralRewardFailureTrigger();
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = $1",
      [GOOGLE_CLERK_USER_ID],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
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
        results.map(({ status }) => status),
        [500, 201],
        "the first request should roll back and the identity-lock waiter should retry successfully",
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

      const legacyCodes = await pool.query<{
        user_id: string;
        owner_user_id: string | null;
        clerk_user_id: string | null;
        code: string;
      }>(
        `SELECT codes.user_id, users.id AS owner_user_id, users.clerk_user_id, codes.code
           FROM daily007_v2_referral_codes AS codes
           LEFT JOIN daily007_v2_users AS users ON users.id = codes.user_id
          ORDER BY codes.user_id`,
      );
      assert.deepEqual(
        legacyCodes.rows,
        [
          {
            user_id: referrerId,
            owner_user_id: referrerId,
            clerk_user_id: null,
            code: REFERRAL_CODE,
          },
          {
            user_id: account.id,
            owner_user_id: account.id,
            clerk_user_id: GOOGLE_CLERK_USER_ID,
            code: referralCodeForUserId(account.id),
          },
        ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
        "legacy codes must belong only to the referrer and the single retrying account",
      );

      const shortCodes = await pool.query<{
        user_id: string;
        owner_user_id: string | null;
        clerk_user_id: string | null;
        code: string;
      }>(
        `SELECT codes.user_id, users.id AS owner_user_id, users.clerk_user_id, codes.code
           FROM daily007_v2_referral_short_codes AS codes
           LEFT JOIN daily007_v2_users AS users ON users.id = codes.user_id
          ORDER BY codes.user_id`,
      );
      assert.deepEqual(
        shortCodes.rows,
        [{
          user_id: account.id,
          owner_user_id: account.id,
          clerk_user_id: GOOGLE_CLERK_USER_ID,
          code: shortReferralCodeForUserId(account.id),
        }],
        "the short-code table must contain exactly one valid row for the retrying account",
      );

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

test("a failed referral signup and same-identity retry leave the referrer's wallet unchanged", async () => {
  const referrerId = randomUUID();
  try {
    await resetReferralRewardFailureTrigger();
    resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Postgres Test Referrer', $2, 'test-salt', 'test-hash', 37)`,
      [referrerId, `referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, idempotency_key, details, created_at)
       VALUES ($1, 37, 37, 'Initial Referrer Balance', $2, '{"source":"rollback-test"}',
               '2026-01-15T10:00:00.000Z')`,
      [referrerId, `test-referrer-wallet:${referrerId}`],
    );

    const readReferrerWalletState = async () => {
      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [referrerId],
      );
      const ledger = await pool.query<{
        id: string;
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string | null;
        details: Record<string, unknown> | null;
        created_at: string;
      }>(
        `SELECT id, user_id, amount, balance_after, reason, idempotency_key, details,
                created_at::text AS created_at
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at ASC, id ASC`,
        [referrerId],
      );
      return { wallet: wallet.rows, ledger: ledger.rows };
    };

    await withServer(async (origin) => {
      const referrerBefore = await readReferrerWalletState();
      assert.deepEqual(referrerBefore.wallet, [{ wallet_coins: 37 }]);
      assert.equal(referrerBefore.ledger.length, 1, "the referrer should have one existing ledger row to protect");

      const failedSignup = await googleSignIn(origin);
      assert.equal(failedSignup.status, 500, "the injected referral reward failure should reject the first signup");
      const failureAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(failureAttempts.rows[0]?.last_value, "1", "the first request should reach the injected failure");
      assert.deepEqual(
        await readReferrerWalletState(),
        referrerBefore,
        "the failed referral signup must not change the referrer's wallet or ledger",
      );

      const retry = await googleSignIn(origin);
      assert.equal(retry.status, 201, "the same Google identity should succeed on retry");
      assert.equal(retry.body.coins, 10);
      const retryRewards = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1`,
        [String(retry.body.id)],
      );
      assert.deepEqual(
        retryRewards.rows,
        [{ amount: 10, balance_after: 10, reason: "Referral Signup Bonus" }],
        "the successful retry must credit the referred player exactly once",
      );
      assert.deepEqual(
        await readReferrerWalletState(),
        referrerBefore,
        "the successful retry must not change the referrer's wallet or ledger",
      );

      const retryAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(retryAttempts.rows[0]?.last_value, "2", "the same Google identity should reach the reward on retry");
    });
  } finally {
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

test("two independent Google signups keep their referral rewards when both transactions succeed", async () => {
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);
  const referrerId = randomUUID();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseTransactionOpen = false;
  let firstSignIn: Promise<JsonResult> | undefined;
  let secondSignIn: Promise<JsonResult> | undefined;

  try {
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_referral_reward_failure ON daily007_v2_wallet_ledger");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_first_referral_reward()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_referral_reward_failure_seq");
    await pool.query(`
      CREATE SEQUENCE daily007_test_independent_reward_pause_seq START 1;
      CREATE FUNCTION daily007_test_pause_first_independent_referral_reward()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.reason = 'Referral Signup Bonus'
           AND nextval('daily007_test_independent_reward_pause_seq') = 1 THEN
          PERFORM pg_advisory_xact_lock(743003, 2);
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER daily007_test_independent_reward_pause
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_pause_first_independent_referral_reward();
    `);
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Independent Signup Referrer', $2, 'test-salt', 'test-hash')`,
      [referrerId, `independent-referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );

    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the reward-pause PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 2)");

      try {
        firstSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID);
        await waitForBlockedBackend(
          blocker.processID,
          "%INSERT INTO daily007_v2_wallet_ledger%",
          "the first independent signup to pause at its referral reward",
        );

        const pendingSecondSignIn = googleSignIn(origin, SECOND_GOOGLE_CLERK_USER_ID);
        secondSignIn = pendingSecondSignIn;
        let secondTimeout: NodeJS.Timeout | undefined;
        let secondResult: JsonResult;
        try {
          secondResult = await Promise.race([
            pendingSecondSignIn,
            new Promise<never>((_resolve, reject) => {
              secondTimeout = setTimeout(
                () => reject(new Error("The second identity did not finish while the first signup was paused.")),
                5_000,
              );
            }),
          ]);
        } finally {
          if (secondTimeout) clearTimeout(secondTimeout);
        }
        assert.equal(secondResult.status, 201,
          "the distinct identity should commit while the first signup transaction remains open");
        assert.equal(secondResult.body.email, SECOND_GOOGLE_EMAIL);
        assert.equal(secondResult.body.coins, 10);
        assert.equal(typeof secondResult.body.token, "string");

        const secondAccount = await pool.query<{
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
        assert.deepEqual(secondAccount.rows, [{
          id: String(secondResult.body.id),
          email: SECOND_GOOGLE_EMAIL,
          wallet_coins: 10,
          clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
        }], "the second signup should be durably committed before the first reward is released");

        const secondReferral = await pool.query<{
          referrer_user_id: string;
          referred_user_id: string;
          code: string;
        }>(
          `SELECT referrer_user_id, referred_user_id, code
             FROM daily007_v2_referrals
            WHERE referred_user_id = $1`,
          [secondResult.body.id],
        );
        assert.deepEqual(secondReferral.rows, [{
          referrer_user_id: referrerId,
          referred_user_id: String(secondResult.body.id),
          code: REFERRAL_CODE,
        }], "the second signup's referral should commit while the first remains pending");

        const secondReward = await pool.query<{
          user_id: string;
          amount: number;
          balance_after: number;
          reason: string;
        }>(
          `SELECT user_id, amount, balance_after, reason
             FROM daily007_v2_wallet_ledger
            WHERE user_id = $1`,
          [secondResult.body.id],
        );
        assert.deepEqual(secondReward.rows, [{
          user_id: String(secondResult.body.id),
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }], "the second signup's reward should commit while the first remains pending");
      } finally {
        if (pauseTransactionOpen && blocker) {
          await blocker.query("ROLLBACK");
          pauseTransactionOpen = false;
        }
      }

      assert.ok(firstSignIn && secondSignIn);
      const [firstResult, secondResult] = await Promise.all([firstSignIn, secondSignIn]);
      assert.deepEqual(
        [firstResult.status, secondResult.status],
        [201, 201],
        "both distinct verified Google identities should finish signup successfully",
      );
      assert.notEqual(firstResult.body.id, secondResult.body.id,
        "each Google identity must retain a distinct Daily007 account");
      assert.deepEqual(
        [
          { email: firstResult.body.email, coins: firstResult.body.coins },
          { email: secondResult.body.email, coins: secondResult.body.coins },
        ],
        [
          { email: GOOGLE_EMAIL, coins: 10 },
          { email: SECOND_GOOGLE_EMAIL, coins: 10 },
        ],
      );
      assert.equal(typeof firstResult.body.token, "string");
      assert.equal(typeof secondResult.body.token, "string");

      const accounts = await pool.query<{
        id: string;
        email: string;
        wallet_coins: number;
        clerk_user_id: string;
      }>(
        `SELECT id, email, wallet_coins, clerk_user_id
           FROM daily007_v2_users
          WHERE clerk_user_id = ANY($1::text[])
          ORDER BY clerk_user_id`,
        [[GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
      );
      assert.equal(accounts.rows.length, 2, "exactly two new Google accounts should remain");
      const accountByIdentity = new Map(accounts.rows.map((account) => [account.clerk_user_id, account]));
      assert.deepEqual(accountByIdentity.get(GOOGLE_CLERK_USER_ID), {
        id: String(firstResult.body.id),
        email: GOOGLE_EMAIL,
        wallet_coins: 10,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      });
      assert.deepEqual(accountByIdentity.get(SECOND_GOOGLE_CLERK_USER_ID), {
        id: String(secondResult.body.id),
        email: SECOND_GOOGLE_EMAIL,
        wallet_coins: 10,
        clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
      }, "both Google identities should have separate accounts with their own 10-coin balances");

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        `SELECT referrer_user_id, referred_user_id, code
           FROM daily007_v2_referrals
          ORDER BY referred_user_id`,
      );
      assert.deepEqual(
        referrals.rows,
        [
          {
            referrer_user_id: referrerId,
            referred_user_id: String(firstResult.body.id),
            code: REFERRAL_CODE,
          },
          {
            referrer_user_id: referrerId,
            referred_user_id: String(secondResult.body.id),
            code: REFERRAL_CODE,
          },
        ].sort((left, right) => left.referred_user_id < right.referred_user_id ? -1 : 1),
        "each signup should retain its own referral relationship",
      );

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [[String(firstResult.body.id), String(secondResult.body.id)]],
      );
      assert.deepEqual(
        rewards.rows,
        [
          String(firstResult.body.id),
          String(secondResult.body.id),
        ].sort().map((userId) => ({
          user_id: userId,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        })),
        "each account should have exactly one persisted 10-coin referral reward",
      );

      for (const result of [firstResult, secondResult]) {
        const walletResponse = await fetch(`${origin}/wallet/transactions`, {
          headers: { authorization: `Bearer ${String(result.body.token)}` },
        });
        const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
        assert.equal(walletResponse.status, 200);
        assert.deepEqual(
          walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
          [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
          `Wallet history should show exactly one referral reward for ${String(result.body.email)}`,
        );
      }

      const rewardPauseCalls = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_independent_reward_pause_seq",
      );
      assert.equal(rewardPauseCalls.rows[0]?.last_value, "2",
        "both distinct signup transactions should reach the isolated PostgreSQL reward trigger");
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
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_independent_reward_pause ON daily007_v2_wallet_ledger");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_first_independent_referral_reward()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_independent_reward_pause_seq");
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = ANY($1::text[])",
      [[GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
});

async function runSameEmailGoogleSignupRace(
  pausedClerkUserId: string,
  winningClerkUserId: string,
): Promise<void> {
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER_WITH_SHARED_EMAIL as unknown as MockGoogleUser,
  ]);
  const referrerId = randomUUID();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseTransactionOpen = false;
  let losingSignIn: Promise<JsonResult> | undefined;
  let winningSignIn: Promise<JsonResult> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Same Email Race Referrer', $2, 'test-salt', 'test-hash')`,
      [referrerId, `same-email-referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );
    await pool.query(`
      CREATE SEQUENCE daily007_test_same_email_signup_pause_seq START 1;
      CREATE FUNCTION daily007_test_pause_first_same_email_signup_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.email = '${GOOGLE_EMAIL}'
           AND nextval('daily007_test_same_email_signup_pause_seq') = 1 THEN
          PERFORM pg_advisory_xact_lock(743003, 3);
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER daily007_test_same_email_signup_pause
      BEFORE INSERT ON daily007_v2_users
      FOR EACH ROW
      EXECUTE FUNCTION daily007_test_pause_first_same_email_signup_insert();
    `);

    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the signup-pause PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 3)");

      try {
        losingSignIn = googleSignIn(origin, pausedClerkUserId);
        await waitForBlockedBackend(
          blocker.processID,
          "%INSERT INTO daily007_v2_users%",
          "the first same-email signup to pause before its account insert",
        );

        const pendingWinningSignIn = googleSignIn(origin, winningClerkUserId);
        winningSignIn = pendingWinningSignIn;
        let winnerTimeout: NodeJS.Timeout | undefined;
        let winnerResult: JsonResult;
        try {
          winnerResult = await Promise.race([
            pendingWinningSignIn,
            new Promise<never>((_resolve, reject) => {
              winnerTimeout = setTimeout(
                () => reject(new Error("The second same-email signup did not finish while the first was paused.")),
                5_000,
              );
            }),
          ]);
        } finally {
          if (winnerTimeout) clearTimeout(winnerTimeout);
        }
        assert.equal(winnerResult.status, 201,
          "one distinct Google identity should commit while the other is paused at the unique email insert");
        assert.equal(winnerResult.body.email, GOOGLE_EMAIL);
        assert.equal(winnerResult.body.coins, 10);
        assert.equal(typeof winnerResult.body.token, "string");

        const winnerAccount = await pool.query<{
          id: string;
          email: string;
          clerk_user_id: string;
          wallet_coins: number;
        }>(
          `SELECT id, email, clerk_user_id, wallet_coins
             FROM daily007_v2_users
            WHERE email = $1`,
          [GOOGLE_EMAIL],
        );
        assert.deepEqual(winnerAccount.rows, [{
          id: String(winnerResult.body.id),
          email: GOOGLE_EMAIL,
          clerk_user_id: winningClerkUserId,
          wallet_coins: 10,
        }], "the winning signup should be committed before the first insert resumes");

        const winnerReferral = await pool.query<{
          referrer_user_id: string;
          referred_user_id: string;
          code: string;
        }>(
          `SELECT referrer_user_id, referred_user_id, code
             FROM daily007_v2_referrals
            WHERE referred_user_id = $1`,
          [winnerResult.body.id],
        );
        assert.deepEqual(winnerReferral.rows, [{
          referrer_user_id: referrerId,
          referred_user_id: String(winnerResult.body.id),
          code: REFERRAL_CODE,
        }], "the winner's referral should commit while the competing signup remains pending");

        const winnerReward = await pool.query<{
          user_id: string;
          amount: number;
          balance_after: number;
          reason: string;
        }>(
          `SELECT user_id, amount, balance_after, reason
             FROM daily007_v2_wallet_ledger
            WHERE user_id = $1`,
          [winnerResult.body.id],
        );
        assert.deepEqual(winnerReward.rows, [{
          user_id: String(winnerResult.body.id),
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }], "the winner's reward should commit while the competing signup remains pending");
      } finally {
        if (pauseTransactionOpen && blocker) {
          await blocker.query("ROLLBACK");
          pauseTransactionOpen = false;
        }
      }

      assert.ok(losingSignIn && winningSignIn);
      const [losingResult, winningResult] = await Promise.all([losingSignIn, winningSignIn]);
      assert.deepEqual(
        [losingResult.status, winningResult.status],
        [409, 201],
        "only one signup should succeed and the losing database insert should return a conflict",
      );
      assert.match(
        String(losingResult.body.error),
        /An account already uses this email.*sign in with your password, then connect Google in Profile/i,
      );
      assert.equal(winningResult.body.email, GOOGLE_EMAIL);
      assert.equal(winningResult.body.coins, 10);

      const accounts = await pool.query<{
        id: string;
        email: string;
        clerk_user_id: string;
        wallet_coins: number;
      }>(
        `SELECT id, email, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE email = $1
             OR clerk_user_id = ANY($2::text[])`,
        [GOOGLE_EMAIL, [GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
      );
      assert.deepEqual(accounts.rows, [{
        id: String(winningResult.body.id),
        email: GOOGLE_EMAIL,
        clerk_user_id: winningClerkUserId,
        wallet_coins: 10,
      }], "exactly one account should remain for the shared email and either competing identity");

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
        referred_user_id: String(winningResult.body.id),
        code: REFERRAL_CODE,
      }], "only the winning signup's referral relationship should remain");

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
        user_id: String(winningResult.body.id),
        amount: 10,
        balance_after: 10,
        reason: "Referral Signup Bonus",
      }], "only one 10-coin reward should remain after the losing signup rolls back");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(winningResult.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
        "the surviving account's Wallet history should contain exactly one signup reward",
      );

      const insertAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_same_email_signup_pause_seq",
      );
      assert.equal(insertAttempts.rows[0]?.last_value, "2",
        "both distinct identities should reach PostgreSQL's same-email account insert");
    });
  } finally {
    if (pauseTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      pauseTransactionOpen = false;
    }
    await Promise.all([
      losingSignIn?.catch(() => undefined),
      winningSignIn?.catch(() => undefined),
    ]);
    blocker?.release();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_same_email_signup_pause ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_first_same_email_signup_insert()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_same_email_signup_pause_seq");
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE clerk_user_id = ANY($1::text[])",
      [[GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
    );
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [referrerId]);
    resetMockGoogleUser();
  }
}

test("the second Google identity wins when the first pauses before the shared-email insert", async () => {
  await runSameEmailGoogleSignupRace(GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID);
});

test("the first Google identity wins when the second pauses before the shared-email insert", async () => {
  await runSameEmailGoogleSignupRace(SECOND_GOOGLE_CLERK_USER_ID, GOOGLE_CLERK_USER_ID);
});

test("a waiting Google signup claims a shared email after the first identity rolls back", async () => {
  await resetReferralRewardFailureTrigger();
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER_WITH_SHARED_EMAIL as unknown as MockGoogleUser,
  ]);
  const referrerId = randomUUID();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseTransactionOpen = false;
  let rolledBackSignIn: Promise<JsonResult> | undefined;
  let waitingSignIn: Promise<JsonResult> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Rollback Race Referrer', $2, 'test-salt', 'test-hash')`,
      [referrerId, `rollback-race-referrer-${referrerId}@example.test`],
    );
    await pool.query(
      "INSERT INTO daily007_v2_referral_codes (user_id, code) VALUES ($1, $2)",
      [referrerId, REFERRAL_CODE],
    );

    await withServer(async (origin) => {
      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the reward-failure pause PID");
      await blocker.query("BEGIN");
      pauseTransactionOpen = true;
      await blocker.query("SELECT pg_advisory_xact_lock(743003, 1)");

      try {
        rolledBackSignIn = googleSignIn(origin, GOOGLE_CLERK_USER_ID);
        const firstRequestPid = await waitForBlockedBackend(
          blocker.processID,
          "%INSERT INTO daily007_v2_wallet_ledger%",
          "the first same-email signup to pause after inserting its uncommitted account",
        );

        waitingSignIn = googleSignIn(origin, SECOND_GOOGLE_CLERK_USER_ID);
        await waitForBlockedBackend(
          firstRequestPid,
          "%INSERT INTO daily007_v2_users%",
          "the second identity to wait on the first signup's uncommitted email insert",
        );

        await blocker.query("COMMIT");
        pauseTransactionOpen = false;
      } finally {
        if (pauseTransactionOpen && blocker) {
          await blocker.query("ROLLBACK");
          pauseTransactionOpen = false;
        }
      }

      assert.ok(rolledBackSignIn && waitingSignIn);
      const [failedResult, successfulResult] = await Promise.all([rolledBackSignIn, waitingSignIn]);
      assert.deepEqual(
        [failedResult.status, successfulResult.status],
        [500, 201],
        "the first transaction should roll back and the waiting identity should claim the email",
      );
      assert.equal(typeof successfulResult.body.id, "string");
      assert.equal(successfulResult.body.email, GOOGLE_EMAIL);
      assert.equal(successfulResult.body.coins, 10);
      assert.equal(typeof successfulResult.body.token, "string");

      const accounts = await pool.query<{
        id: string;
        email: string;
        clerk_user_id: string;
        wallet_coins: number;
      }>(
        `SELECT id, email, clerk_user_id, wallet_coins
           FROM daily007_v2_users
          WHERE email = $1
             OR clerk_user_id = ANY($2::text[])`,
        [GOOGLE_EMAIL, [GOOGLE_CLERK_USER_ID, SECOND_GOOGLE_CLERK_USER_ID]],
      );
      assert.deepEqual(accounts.rows, [{
        id: String(successfulResult.body.id),
        email: GOOGLE_EMAIL,
        clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
        wallet_coins: 10,
      }], "only the waiting identity's account should remain for the shared email");

      const accountCount = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_users",
      );
      assert.equal(accountCount.rows[0]?.count, 2, "only the referrer and successful account should remain");

      const legacyCodes = await pool.query<{
        user_id: string;
        owner_user_id: string | null;
        clerk_user_id: string | null;
        code: string;
      }>(
        `SELECT codes.user_id, users.id AS owner_user_id, users.clerk_user_id, codes.code
           FROM daily007_v2_referral_codes AS codes
           LEFT JOIN daily007_v2_users AS users ON users.id = codes.user_id
          ORDER BY codes.user_id`,
      );
      assert.deepEqual(
        legacyCodes.rows,
        [
          {
            user_id: referrerId,
            owner_user_id: referrerId,
            clerk_user_id: null,
            code: REFERRAL_CODE,
          },
          {
            user_id: String(successfulResult.body.id),
            owner_user_id: String(successfulResult.body.id),
            clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
            code: referralCodeForUserId(String(successfulResult.body.id)),
          },
        ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
        "the rolled-back identity must leave no legacy referral-code row",
      );

      const shortCodes = await pool.query<{
        user_id: string;
        owner_user_id: string | null;
        clerk_user_id: string | null;
        code: string;
      }>(
        `SELECT codes.user_id, users.id AS owner_user_id, users.clerk_user_id, codes.code
           FROM daily007_v2_referral_short_codes AS codes
           LEFT JOIN daily007_v2_users AS users ON users.id = codes.user_id
          ORDER BY codes.user_id`,
      );
      assert.deepEqual(shortCodes.rows, [{
        user_id: String(successfulResult.body.id),
        owner_user_id: String(successfulResult.body.id),
        clerk_user_id: SECOND_GOOGLE_CLERK_USER_ID,
        code: shortReferralCodeForUserId(String(successfulResult.body.id)),
      }], "only the successful identity's short referral code should remain");

      const referrals = await pool.query<{
        referrer_user_id: string;
        referred_user_id: string;
        code: string;
      }>(
        "SELECT referrer_user_id, referred_user_id, code FROM daily007_v2_referrals",
      );
      assert.deepEqual(referrals.rows, [{
        referrer_user_id: referrerId,
        referred_user_id: String(successfulResult.body.id),
        code: REFERRAL_CODE,
      }], "only the successful signup's referral should remain");

      const rewards = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        "SELECT user_id, amount, balance_after, reason FROM daily007_v2_wallet_ledger",
      );
      assert.deepEqual(rewards.rows, [{
        user_id: String(successfulResult.body.id),
        amount: 10,
        balance_after: 10,
        reason: "Referral Signup Bonus",
      }], "the successful account should have one 10-coin reward and no failed reward row");

      const failureAttempts = await pool.query<{ last_value: string }>(
        "SELECT last_value::text FROM daily007_test_referral_reward_failure_seq",
      );
      assert.equal(failureAttempts.rows[0]?.last_value, "2",
        "both identities should reach the reward write, with only the first attempt failing");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(successfulResult.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Referral Signup Bonus" }],
        "the successful account's Wallet history should contain exactly one signup reward",
      );
    });
  } finally {
    if (pauseTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      pauseTransactionOpen = false;
    }
    await Promise.all([
      rolledBackSignIn?.catch(() => undefined),
      waitingSignIn?.catch(() => undefined),
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