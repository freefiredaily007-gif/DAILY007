import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import test, { after } from "node:test";
import type { User } from "@clerk/express";
import daily007V2Router from "../src/routes/daily007-v2";
import daily007GoogleAuthRouter from "../src/routes/daily007-google-auth";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  chooseGoogleAccountAction,
  verifiedGoogleIdentity,
} from "../src/lib/daily007-google-auth-validation.ts";
import { shortReferralCodeForUserId } from "../src/lib/daily007-compat-extra-validation";
import { logoutDaily007 } from "../../daily007/src/lib/logout";
import {
  failNextMockGoogleUserLookup,
  getMockGoogleUserLookupCount,
  hangNextMockGoogleUserLookup,
  resetMockGoogleUser,
  resetMockGoogleUsers,
  updateMockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";
import type { User as MockGoogleUser } from "./support/daily007-google-auth-clerk-mock";
import {
  SIGNUP_TEST_LEGACY_REFERRAL_CODE,
  SIGNUP_TEST_REFERRAL_CODE,
  SIGNUP_TEST_UNKNOWN_LEGACY_REFERRAL_CODE,
  signupTestDb,
} from "./support/daily007-signup-test-db";

const GOOGLE_CLERK_USER_ID = "clerk-google-signup-test";
const SECOND_GOOGLE_CLERK_USER_ID = "clerk-google-signup-test-second";
const TEST_AUTH_SECRET = "google-signup-reward-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  resetMockGoogleUser();
});

async function withGoogleAuthServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      auth: { userId: req.get("x-mock-clerk-user-id") ?? GOOGLE_CLERK_USER_ID },
    });
    next();
  });
  app.use(daily007V2Router);
  app.use(daily007GoogleAuthRouter);
  app.use(daily007CompatExtraRouter);

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

const VERIFIED_GOOGLE_USER = {
  id: GOOGLE_CLERK_USER_ID,
  firstName: "Google",
  lastName: "Signup",
  emailAddresses: [{
    emailAddress: "google-signup@example.test",
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: "google-signup@example.test",
    firstName: "Google",
    lastName: "Signup",
    verification: { status: "verified" },
  }],
} as unknown as User;

const SECOND_VERIFIED_GOOGLE_USER = {
  id: SECOND_GOOGLE_CLERK_USER_ID,
  firstName: "Second",
  lastName: "Player",
  emailAddresses: [{
    emailAddress: "second-google-signup@example.test",
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: "second-google-signup@example.test",
    firstName: "Second",
    lastName: "Player",
    verification: { status: "verified" },
  }],
} as unknown as User;

const MISMATCHED_VERIFIED_GOOGLE_USER = {
  ...VERIFIED_GOOGLE_USER,
  emailAddresses: [{
    emailAddress: "different-google-signup@example.test",
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: "different-google-signup@example.test",
    firstName: "Google",
    lastName: "Signup",
    verification: { status: "verified" },
  }],
} as unknown as User;

type JsonResult = { status: number; body: Record<string, any> };

async function postJson(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  return { status: response.status, body: await response.json() };
}

function googleAuth(
  origin: string,
  dailyToken?: string,
  referralCode?: string,
  clerkUserId = GOOGLE_CLERK_USER_ID,
  signal?: AbortSignal,
): Promise<JsonResult> {
  return postJson(origin, "/auth/google", referralCode ? { referralCode } : {}, {
    authorization: "Bearer mocked-clerk-session",
    "x-mock-clerk-user-id": clerkUserId,
    ...(dailyToken ? { "X-Daily007-Token": dailyToken } : {}),
  }, signal);
}

async function rawGoogleSignup(
  origin: string,
  clerkUserId: string,
): Promise<{ status: number; body: Record<string, any> | null }> {
  const response = await fetch(`${origin}/auth/google`, {
    method: "POST",
    headers: {
      authorization: "Bearer mocked-clerk-session",
      "content-type": "application/json",
      "x-mock-clerk-user-id": clerkUserId,
    },
    body: JSON.stringify({ referralCode: SIGNUP_TEST_REFERRAL_CODE }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: response.status === 201 ? JSON.parse(text) as Record<string, any> : null,
  };
}

async function createPasswordAccount(origin: string, email: string) {
  const registration = await postJson(origin, "/daily007/v2/auth/register", {
    name: "Password Account",
    email,
    password: "google-link-test-password",
  });
  assert.equal(registration.status, 201, "password account should be created");

  const accountId = String(registration.body.account.id);
  const login = await postJson(origin, "/daily007/v2/auth/login", {
    email,
    password: "google-link-test-password",
  });
  assert.equal(login.status, 200, "password account should receive a valid Daily007 session");
  assert.equal(typeof login.body.token, "string");

  const account = signupTestDb.users.get(accountId);
  assert.ok(account, "registered password account should exist in the isolated database");
  return { account, token: String(login.body.token) };
}

test("Google identity requires both a verified Google external account and verified Clerk email", () => {
  const identity = verifiedGoogleIdentity({
    id: "user_clerk_123",
    firstName: "Daily",
    lastName: "Player",
    emailAddresses: [{
      emailAddress: "Player@Example.com",
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "player@example.com",
      firstName: "Google",
      lastName: "Player",
      verification: { status: "verified" },
    }],
  } as unknown as User);
  assert.deepEqual(identity, {
    clerkUserId: "user_clerk_123",
    email: "player@example.com",
    name: "Daily Player",
  });

  const unverified = verifiedGoogleIdentity({
    id: "user_clerk_123",
    emailAddresses: [{ emailAddress: "player@example.com", verification: { status: "unverified" } }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "player@example.com",
      verification: { status: "verified" },
    }],
  } as unknown as User);
  assert.equal(unverified, null);
});

test("Google sign-in decisions prohibit automatic email linking and permit explicit same-email linking", () => {
  const base = {
    linkedUserId: null,
    linkedEmail: null,
    emailOwnerUserId: "local-user",
    localTokenUserId: null,
    verifiedEmail: "player@example.com",
  };
  assert.equal(chooseGoogleAccountAction(base), "email-conflict");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    localTokenUserId: "local-user",
  }), "link");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    emailOwnerUserId: null,
    localTokenUserId: null,
  }), "create");
});

test("linked identities are immutable to other local accounts and email mismatches", () => {
  const base = {
    linkedUserId: "linked-user",
    linkedEmail: "player@example.com",
    emailOwnerUserId: "linked-user",
    localTokenUserId: null,
    verifiedEmail: "player@example.com",
  };
  assert.equal(chooseGoogleAccountAction(base), "existing");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    localTokenUserId: "other-user",
  }), "linked-elsewhere");
  assert.equal(chooseGoogleAccountAction({
    ...base,
    linkedEmail: "changed@example.com",
  }), "email-mismatch");
});

test("first and repeated Google sign-ins keep one Daily007 account and one signup reward", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signupResponse = await googleAuth(origin);
      const signup = signupResponse.body;

      assert.equal(signupResponse.status, 201);
      assert.equal(signup.coins, 10);
      assert.equal(typeof signup.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const userId = String(signup.id);
      const account = signupTestDb.users.get(userId);
      assert.ok(account, "Google signup should create a new Daily007 account");
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 10);

      const signupRewards = signupTestDb.ledger.filter(
        (entry) => entry.user_id === userId && entry.reason === "Welcome Signup Bonus",
      );
      assert.equal(signupRewards.length, 1);
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after }) => ({ amount, balance_after })),
        [{ amount: 10, balance_after: 10 }],
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.equal(walletHistory.length, 1);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        [{ amount: 10, balanceAfter: 10, reason: "Welcome Signup Bonus" }],
      );

      const repeat = await googleAuth(origin);
      assert.equal(repeat.status, 200);
      assert.equal(repeat.body.id, userId);
      assert.equal(repeat.body.coins, 10);
      assert.notEqual(repeat.body.token, signup.token);
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(signupTestDb.users.size, 2, "repeat sign-in must not create another account");
      assert.equal(signupTestDb.ledger.filter(
        (entry) => entry.user_id === userId && entry.reason === "Welcome Signup Bonus",
      ).length, 1, "repeat sign-in must not issue another signup reward");

      const repeatWalletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(repeat.body.token)}` },
      });
      const repeatWalletHistory = await repeatWalletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(repeatWalletResponse.status, 200);
      assert.equal(repeatWalletHistory.length, 1);
      assert.equal(repeatWalletHistory[0].amount, 10);

      const replacedWalletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.token)}` },
      });
      assert.equal(replacedWalletResponse.status, 401, "repeat Google sign-in should replace the older session");
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("password signup normalizes lowercase short referral codes and awards one referral bonus", async () => {
  signupTestDb.reset();

  try {
    await withGoogleAuthServer(async (origin) => {
      const registration = await postJson(origin, "/daily007/v2/auth/register", {
        name: "Password Referred Player",
        email: "password-referral-signup@example.test",
        password: "password-referral-test-password",
        referralCode: `  ${SIGNUP_TEST_REFERRAL_CODE.toLowerCase()}  `,
      });
      assert.equal(registration.status, 201, "password signup should accept a lowercase short referral code");
      assert.equal(typeof registration.body.token, "string");
      assert.equal(registration.body.account.wallet_coins, 10);

      const accountId = String(registration.body.account.id);
      const account = signupTestDb.users.get(accountId);
      assert.ok(account, "the password signup should create a Daily007 account");
      assert.equal(account.email, "password-referral-signup@example.test");
      assert.equal(account.referral_code, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(account.wallet_coins, 10);
      assert.equal(signupTestDb.users.size, 2, "only the referrer and new password account should exist");

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer, "the isolated fixture should contain the short-code owner");
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: accountId,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
        "the referral should point to the correct owner and store the canonical short code",
      );

      const signupRewards = signupTestDb.ledger.filter((entry) => entry.user_id === accountId);
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
        "password signup should issue exactly one 10-coin referral bonus and no welcome bonus",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("Google signup uses a fallback short code that the next player can redeem", async () => {
  signupTestDb.reset();
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);

  const newAccountId = "40000000-0000-4000-8000-000000000002";
  const firstCandidate = shortReferralCodeForUserId(newAccountId, 0);
  const fallbackCandidate = shortReferralCodeForUserId(newAccountId, 1);
  const referrer = [...signupTestDb.users.values()].find(
    (user) => user.email === "referrer@example.test",
  );
  assert.ok(referrer, "the isolated fixture should contain the code-owning test account");
  assert.notEqual(firstCandidate, fallbackCandidate);

  const originalCode = signupTestDb.shortCodesByUser.get(referrer.id);
  assert.ok(originalCode);
  signupTestDb.shortCodeOwners.delete(originalCode);
  signupTestDb.shortCodesByUser.set(referrer.id, firstCandidate);
  signupTestDb.shortCodeOwners.set(firstCandidate, referrer.id);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signup = await googleAuth(origin);

      assert.equal(signup.status, 201, "a short-code collision must not reject Google signup");
      assert.equal(signup.body.id, newAccountId);
      assert.equal(signup.body.coins, 10);
      assert.equal(typeof signup.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1, "signup should leave one account linked to Google");

      assert.equal(signupTestDb.shortCodesByUser.get(referrer.id), firstCandidate);
      assert.equal(
        signupTestDb.shortCodesByUser.get(newAccountId),
        fallbackCandidate,
        "signup should save the next available candidate",
      );
      assert.equal(signupTestDb.shortCodeOwners.get(firstCandidate), referrer.id);
      assert.equal(signupTestDb.shortCodeOwners.get(fallbackCandidate), newAccountId);
      assert.equal(
        new Set(signupTestDb.shortCodeOwners.keys()).size,
        signupTestDb.shortCodeOwners.size,
        "no duplicate short code should be assigned",
      );

      const signupRewards = signupTestDb.ledger.filter(
        (entry) => entry.user_id === newAccountId,
      );
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{ amount: 10, balance_after: 10, reason: "Welcome Signup Bonus" }],
        "the successful fallback signup should receive exactly one reward",
      );

      const secondSignup = await googleAuth(
        origin,
        undefined,
        fallbackCandidate,
        SECOND_GOOGLE_CLERK_USER_ID,
      );
      assert.equal(secondSignup.status, 201, "a second player should be able to use the fallback code");
      assert.equal(secondSignup.body.coins, 10);
      assert.equal(typeof secondSignup.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 2);

      const secondAccountId = String(secondSignup.body.id);
      const secondAccount = signupTestDb.users.get(secondAccountId);
      assert.ok(secondAccount, "the second Google signup should create a Daily007 account");
      assert.equal(secondAccount.clerk_user_id, SECOND_GOOGLE_CLERK_USER_ID);
      assert.equal(secondAccount.wallet_coins, 10);
      assert.equal(signupTestDb.shortCodeOwners.get(fallbackCandidate), newAccountId);

      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: newAccountId,
          referred_user_id: secondAccountId,
          code: fallbackCandidate,
        }],
        "the referral relationship should credit the first Google account using its fallback code",
      );

      const secondSignupRewards = signupTestDb.ledger.filter(
        (entry) => entry.user_id === secondAccountId,
      );
      assert.deepEqual(
        secondSignupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
        "the second player should receive exactly one 10-coin referral signup reward",
      );
      assert.equal(
        secondSignupRewards.filter((entry) => entry.reason === "Welcome Signup Bonus").length,
        0,
        "the second player must not also receive the Welcome Signup Bonus",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("referred Google signup and repeat sign-in keep one 10-coin referral reward", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signupResponse = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      const signup = signupResponse.body;

      assert.equal(signupResponse.status, 201);
      assert.equal(signup.coins, 10);
      assert.equal(typeof signup.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const userId = String(signup.id);
      const account = signupTestDb.users.get(userId);
      assert.ok(account, "referred Google signup should create a Daily007 account");
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 10);

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer, "the isolated fixture should contain the test referrer");
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: userId,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
      );

      const signupRewards = signupTestDb.ledger.filter((entry) => entry.user_id === userId);
      assert.equal(signupRewards.length, 1, "the referred account should receive only one signup reward");
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
      );
      assert.equal(
        signupRewards.filter((entry) => entry.reason === "Welcome Signup Bonus").length,
        0,
        "a referral signup must not also receive a Welcome Signup Bonus",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.equal(walletHistory.length, 1);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );

      const referralsBeforeRepeat = structuredClone(signupTestDb.referrals);
      const ledgerBeforeRepeat = structuredClone(signupTestDb.ledger);
      const repeat = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(repeat.status, 200);
      assert.equal(repeat.body.id, userId);
      assert.equal(repeat.body.coins, 10);
      assert.equal(typeof repeat.body.token, "string");
      assert.notEqual(repeat.body.token, signup.token);
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(signupTestDb.users.size, 2, "repeat sign-in must reuse the existing account");
      assert.equal(account.wallet_coins, 10, "repeat sign-in must preserve the original balance");
      assert.deepEqual(
        signupTestDb.referrals,
        referralsBeforeRepeat,
        "repeat sign-in must not create another referral relationship",
      );
      assert.deepEqual(
        signupTestDb.ledger,
        ledgerBeforeRepeat,
        "repeat sign-in must not create another wallet ledger entry",
      );

      const repeatWalletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(repeat.body.token)}` },
      });
      const repeatWalletHistory = await repeatWalletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(repeatWalletResponse.status, 200);
      assert.equal(repeatWalletHistory.length, 1);
      assert.deepEqual(
        repeatWalletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("simultaneous referred Google sign-ins create one account and one 10-coin reward", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([
        googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE),
        googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE),
      ]);

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [200, 201],
        "one request should create the referred account while the other reuses it",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(
        signupTestDb.advisoryLockWaitCount,
        1,
        "the requests should contend on the same transaction-scoped identity lock",
      );

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1);
      assert.equal(signupTestDb.users.size, 2, "only the seeded referrer and one Google account should exist");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.ok(signIns.every(({ body }) => body.id === account.id));
      assert.ok(signIns.every(({ body }) => body.coins === 10));
      assert.ok(signIns.every(({ body }) => typeof body.token === "string"));

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: account.id,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
      );

      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
      );

      const walletResponses = await Promise.all(signIns.map(async ({ body }) => {
        const response = await fetch(`${origin}/wallet/transactions`, {
          headers: { authorization: `Bearer ${String(body.token)}` },
        });
        return {
          status: response.status,
          history: response.status === 200
            ? await response.json() as Array<Record<string, unknown>>
            : [],
        };
      }));
      const validWalletHistories = walletResponses.filter(({ status }) => status === 200);
      assert.equal(validWalletHistories.length, 1, "only the latest simultaneous sign-in session should remain valid");
      assert.deepEqual(
        validWalletHistories[0].history.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );
      assert.deepEqual(
        walletResponses.map(({ status }) => status).sort((left, right) => left - right),
        [200, 401],
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a same-identity sign-in waiting on a failed welcome reward succeeds after rollback", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextWelcomeSignupRewardLedgerWrite();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([1, 2].map(async () => {
        const response = await fetch(`${origin}/auth/google`, {
          method: "POST",
          headers: {
            authorization: "Bearer mocked-clerk-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        if (response.status === 201) {
          return {
            status: response.status,
            body: await response.json() as Record<string, unknown>,
          };
        }
        await response.text();
        return { status: response.status, body: null };
      }));

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "the first transaction should fail and its waiting request should create the account",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(
        signupTestDb.advisoryLockWaitCount,
        1,
        "both requests should contend on the same provider-identity lock",
      );
      assert.deepEqual(signupTestDb.welcomeSignupRewardLedgerFailureContext, {
        accountExists: true,
        legacyCodeExists: true,
        shortCodeExists: true,
        walletCoins: 10,
      }, "the injected failure should happen after signup state and wallet changes begin");

      const failedSignIn = signIns.find(({ status }) => status === 500);
      const recoveredSignIn = signIns.find(({ status }) => status === 201);
      assert.ok(failedSignIn);
      assert.ok(recoveredSignIn?.body);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1);
      assert.equal(signupTestDb.users.size, 2, "only the seeded user and one Google account should remain");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);
      assert.deepEqual(signupTestDb.referrals, [], "a non-referred signup must not create a referral");
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
        }],
        "rollback and retry must leave exactly one complete welcome reward",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(recoveredSignIn.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as {
        amount: number;
        balanceAfter: number;
        reason: string;
      }[];
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Welcome Signup Bonus",
        }],
        "the recovered account should show one welcome reward in Wallet history",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a same-identity sign-in waiting on a failed referral reward succeeds after rollback", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextReferralSignupRewardLedgerWrite();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([1, 2].map(async () => {
        const response = await fetch(`${origin}/auth/google`, {
          method: "POST",
          headers: {
            authorization: "Bearer mocked-clerk-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({ referralCode: SIGNUP_TEST_REFERRAL_CODE }),
        });
        if (response.status === 201) {
          return {
            status: response.status,
            body: await response.json() as Record<string, unknown>,
          };
        }
        await response.text();
        return { status: response.status, body: null };
      }));

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "the first transaction should fail and its waiting request should create the account",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(
        signupTestDb.advisoryLockWaitCount,
        1,
        "both requests should reach and contend on the same identity lock",
      );
      assert.equal(
        signupTestDb.activeAdvisoryLockCount,
        0,
        "the failed transaction must release its lock so the waiter can finish",
      );
      assert.deepEqual(signupTestDb.referralSignupRewardLedgerFailureContext, {
        accountExists: true,
        referralExists: true,
        walletCoins: 10,
      }, "the injected failure should happen after referral and wallet changes begin");

      const failedSignIn = signIns.find(({ status }) => status === 500);
      const recoveredSignIn = signIns.find(({ status }) => status === 201);
      assert.ok(failedSignIn);
      assert.ok(recoveredSignIn?.body);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1);
      assert.equal(signupTestDb.users.size, 2, "only the referrer and one new Google account should remain");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.equal(referrer.wallet_coins, 0);
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: account.id,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
        "the successful waiting request should leave one referral relationship",
      );
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
        "the failed transaction must not leave a duplicate or partial reward",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(recoveredSignIn.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as {
        amount: number;
        balanceAfter: number;
        reason: string;
      }[];
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
        "the recovered account should show exactly one signup reward in Wallet history",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a same-identity sign-in waiting on a failed welcome reward succeeds after rollback", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextWelcomeSignupRewardLedgerWrite();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([1, 2].map(async () => {
        const response = await fetch(`${origin}/auth/google`, {
          method: "POST",
          headers: {
            authorization: "Bearer mocked-clerk-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: response.status === 201 ? JSON.parse(text) as Record<string, unknown> : null,
        };
      }));

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "the failed signup should roll back so its waiting request can create the account",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(
        signupTestDb.advisoryLockWaitCount,
        1,
        "both requests should reach and contend on the same identity lock",
      );
      assert.equal(
        signupTestDb.activeAdvisoryLockCount,
        0,
        "the failed transaction must release its lock so the waiter can finish",
      );
      assert.deepEqual(signupTestDb.welcomeSignupRewardLedgerFailureContext, {
        accountExists: true,
        legacyCodeExists: true,
        shortCodeExists: true,
        walletCoins: 10,
      }, "the failure should occur after the account, referral codes, and wallet update begin");

      const failedSignIn = signIns.find(({ status }) => status === 500);
      const recoveredSignIn = signIns.find(({ status }) => status === 201);
      assert.ok(failedSignIn);
      assert.equal(failedSignIn.body, null);
      assert.ok(recoveredSignIn);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1);
      assert.equal(signupTestDb.users.size, 2, "only the seeded referrer and one Google account should remain");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);
      assert.equal(signupTestDb.referrals.length, 0, "an un-referred signup must not create a referral");

      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
        }],
        "the failed transaction must not leave a duplicate or partial wallet reward",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(recoveredSignIn.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as {
        amount: number;
        balanceAfter: number;
        reason: string;
      }[];
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Welcome Signup Bonus",
        }],
        "the recovered account should show exactly one welcome reward in Wallet history",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a same-identity sign-in waiting on a failed session-version update succeeds after rollback", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextAuthVersionUpdate();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([1, 2].map(async () => {
        const response = await fetch(`${origin}/auth/google`, {
          method: "POST",
          headers: {
            authorization: "Bearer mocked-clerk-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: response.status === 201 ? JSON.parse(text) as Record<string, unknown> : null,
        };
      }));

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "the session-version failure should roll back so the waiting request can create the account",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(signupTestDb.advisoryLockWaitCount, 1);
      assert.equal(
        signupTestDb.activeAdvisoryLockCount,
        0,
        "the failed transaction must release its identity lock so the waiter can finish",
      );
      assert.deepEqual(
        signupTestDb.authVersionUpdateFailureContext,
        {
          accountExists: true,
          walletCoins: 10,
          welcomeRewardCount: 1,
        },
        "the injected failure should happen after signup and its welcome reward are written",
      );

      const failedSignIn = signIns.find(({ status }) => status === 500);
      const recoveredSignIn = signIns.find(({ status }) => status === 201);
      assert.ok(failedSignIn);
      assert.equal(failedSignIn.body, null);
      assert.ok(recoveredSignIn);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1);
      assert.equal(signupTestDb.users.size, 2, "only the seeded user and one Google account should remain");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.equal(account.auth_version, 1);
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);
      assert.deepEqual(signupTestDb.referrals, []);
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
        }],
        "rollback and retry must leave exactly one complete welcome reward",
      );

    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a failed referral reward rollback preserves another identity's completed Google signup", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextReferralSignupRewardLedgerWrite();
  const failurePause = signupTestDb.pauseNextReferralSignupRewardLedgerFailure();
  resetMockGoogleUsers([
    VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
    SECOND_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser,
  ]);

  try {
    await withGoogleAuthServer(async (origin) => {
      const identities = [
        {
          clerkUserId: GOOGLE_CLERK_USER_ID,
          email: "google-signup@example.test",
        },
        {
          clerkUserId: SECOND_GOOGLE_CLERK_USER_ID,
          email: "second-google-signup@example.test",
        },
      ];
      const signIns = identities.map((identity) => ({
        ...identity,
        result: rawGoogleSignup(origin, identity.clerkUserId).then((result) => ({
          ...identity,
          ...result,
        })),
      }));

      try {
        let failureReachedTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            failurePause.reached,
            new Promise<void>((_resolve, reject) => {
              failureReachedTimeout = setTimeout(
                () => reject(new Error("The referral reward failure was not reached.")),
                2_000,
              );
            }),
          ]);
        } finally {
          if (failureReachedTimeout) clearTimeout(failureReachedTimeout);
        }

        const firstCompleted = await Promise.race(signIns.map(({ result }) => result));
        assert.equal(
          firstCompleted.status,
          201,
          "the independent signup should commit while the failed transaction remains open",
        );
        assert.ok(firstCompleted.body);

        failurePause.release();
        const results = await Promise.all(signIns.map(({ result }) => result));
        assert.deepEqual(
          results.map(({ status }) => status).sort((left, right) => left - right),
          [201, 500],
          "one identity should fail while the other completes",
        );
        assert.equal(getMockGoogleUserLookupCount(), 2);
        assert.equal(
          signupTestDb.advisoryLockWaitCount,
          0,
          "different Clerk identities must not contend on the identity lock",
        );
        assert.equal(
          signupTestDb.activeAdvisoryLockCount,
          0,
          "both completed signup transactions must release their locks",
        );
        assert.deepEqual(signupTestDb.referralSignupRewardLedgerFailureContext, {
          accountExists: true,
          referralExists: true,
          walletCoins: 10,
        }, "the failed signup should roll back after its referral and wallet changes began");

        const successfulSignup = results.find(({ status }) => status === 201);
        const failedSignup = results.find(({ status }) => status === 500);
        assert.ok(successfulSignup?.body);
        assert.ok(failedSignup);
        const failedUserId = signupTestDb.failedReferralSignupRewardUserId;
        assert.ok(failedUserId, "the injected failure should identify the account being rolled back");

        assert.equal(signupTestDb.users.has(failedUserId), false);
        assert.equal(
          [...signupTestDb.users.values()].some(
            (user) => user.email === failedSignup.email ||
              user.clerk_user_id === failedSignup.clerkUserId,
          ),
          false,
          "the failed identity must not leave an account or identity link",
        );
        assert.equal(
          signupTestDb.referrals.some((referral) => referral.referred_user_id === failedUserId),
          false,
          "the failed identity must not leave a referral relationship",
        );
        assert.equal(
          signupTestDb.ledger.some((entry) => entry.user_id === failedUserId),
          false,
          "the failed identity must not leave a wallet entry",
        );

        const successfulAccount = signupTestDb.users.get(String(successfulSignup.body.id));
        assert.ok(successfulAccount);
        assert.equal(successfulAccount.clerk_user_id, successfulSignup.clerkUserId);
        assert.equal(successfulAccount.email, successfulSignup.email);
        assert.equal(successfulAccount.wallet_coins, 10);
        assert.equal(successfulSignup.body.coins, 10);
        assert.equal(typeof successfulSignup.body.token, "string");
        assert.equal(signupTestDb.users.size, 2, "the referrer and only the successful Google account should remain");

        const referrer = [...signupTestDb.users.values()].find(
          (user) => user.email === "referrer@example.test",
        );
        assert.ok(referrer);
        assert.deepEqual(
          signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
            referrer_user_id,
            referred_user_id,
            code,
          })),
          [{
            referrer_user_id: referrer.id,
            referred_user_id: successfulAccount.id,
            code: SIGNUP_TEST_REFERRAL_CODE,
          }],
          "the successful identity's referral must survive the other transaction's rollback",
        );
        assert.deepEqual(
          signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
            user_id,
            amount,
            balance_after,
            reason,
          })),
          [{
            user_id: successfulAccount.id,
            amount: 10,
            balance_after: 10,
            reason: "Referral Signup Bonus",
          }],
          "only the successful signup's 10-coin reward should remain",
        );

        const walletResponse = await fetch(`${origin}/wallet/transactions`, {
          headers: { authorization: `Bearer ${String(successfulSignup.body.token)}` },
        });
        assert.equal(walletResponse.status, 200);
        const walletHistory = await walletResponse.json() as {
          amount: number;
          balanceAfter: number;
          reason: string;
        }[];
        assert.deepEqual(
          walletHistory.map(({ amount, balanceAfter, reason }) => ({
            amount,
            balanceAfter,
            reason,
          })),
          [{
            amount: 10,
            balanceAfter: 10,
            reason: "Referral Signup Bonus",
          }],
        );
      } finally {
        failurePause.release();
      }
    });
  } finally {
    failurePause.release();
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("referral reward ledger failure rolls back a Google signup and Clerk identity link", async () => {
  signupTestDb.reset();
  signupTestDb.failNextReferralSignupRewardLedgerWrite();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const failedSignup = await fetch(`${origin}/auth/google`, {
        method: "POST",
        headers: {
          authorization: "Bearer mocked-clerk-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({ referralCode: SIGNUP_TEST_REFERRAL_CODE }),
      });

      assert.equal(failedSignup.status, 500);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(signupTestDb.referralSignupRewardLedgerFailureContext, {
        accountExists: true,
        referralExists: true,
        walletCoins: 10,
      });

      assert.equal(signupTestDb.users.size, 1, "the failed signup must not leave a new account");
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.email === "google-signup@example.test",
        ),
        false,
        "the failed signup must not leave its account email behind",
      );
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
        ),
        false,
        "the failed signup must not leave the Clerk identity linked",
      );
      assert.equal(signupTestDb.referrals.length, 0, "the failed signup must not leave a referral");
      assert.equal(signupTestDb.ledger.length, 0, "the failed signup must not leave a wallet entry");
      assert.equal(signupTestDb.shortCodesByUser.size, 1, "the new account's referral code must roll back");

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.equal(referrer.wallet_coins, 0, "the failed signup must not change the referrer's wallet");

      const retriedSignup = await googleAuth(
        origin,
        undefined,
        SIGNUP_TEST_REFERRAL_CODE,
      );
      assert.equal(retriedSignup.status, 201, "the same verified Google identity should be able to retry");
      assert.equal(retriedSignup.body.coins, 10);
      assert.equal(typeof retriedSignup.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 2);

      const retriedAccountId = String(retriedSignup.body.id);
      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1, "retry should leave exactly one account linked to the Google identity");
      assert.equal(signupTestDb.users.size, 2, "retry should leave only the referrer and one Google account");
      const retriedAccount = signupTestDb.users.get(retriedAccountId);
      assert.ok(retriedAccount);
      assert.equal(retriedAccount.email, "google-signup@example.test");
      assert.equal(retriedAccount.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(retriedAccount.wallet_coins, 10);

      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: retriedAccountId,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
        "retry should create exactly one referral relationship",
      );
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: retriedAccountId,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
        "retry should create exactly one 10-coin referral reward",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("referral short-code failure rolls back a Google signup and Clerk identity link", async () => {
  signupTestDb.reset();
  const originalShortCodesByUser = new Map(signupTestDb.shortCodesByUser);
  const originalShortCodeOwners = new Map(signupTestDb.shortCodeOwners);
  const originalLegacyCodeOwners = new Map(signupTestDb.legacyCodeOwners);
  signupTestDb.failNextReferralShortCodeInsert();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const failedSignup = await fetch(`${origin}/auth/google`, {
        method: "POST",
        headers: {
          authorization: "Bearer mocked-clerk-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });

      assert.equal(failedSignup.status, 500);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(signupTestDb.referralCodeInsertFailureContext, {
        accountExists: true,
        legacyCodeExists: true,
        shortCodeExists: false,
      }, "the failure should occur after the account and legacy referral code are written");

      assert.equal(signupTestDb.users.size, 1, "the failed signup must not leave a new account");
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.email === "google-signup@example.test",
        ),
        false,
        "the failed signup must not leave its account email behind",
      );
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
        ),
        false,
        "the failed signup must not leave the Clerk identity linked",
      );
      assert.deepEqual(signupTestDb.shortCodesByUser, originalShortCodesByUser);
      assert.deepEqual(signupTestDb.shortCodeOwners, originalShortCodeOwners);
      assert.deepEqual(signupTestDb.legacyCodeOwners, originalLegacyCodeOwners);
      assert.equal(signupTestDb.referrals.length, 0);
      assert.equal(signupTestDb.ledger.length, 0);

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.equal(referrer.wallet_coins, 0);
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a same-identity sign-in waiting on a failed referral short-code write succeeds after rollback", async () => {
  signupTestDb.reset();
  signupTestDb.synchronizeNextAdvisoryLockQueries(2);
  signupTestDb.failNextReferralShortCodeInsert();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signIns = await Promise.all([1, 2].map(async () => {
        const response = await fetch(`${origin}/auth/google`, {
          method: "POST",
          headers: {
            authorization: "Bearer mocked-clerk-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: response.status === 201 ? JSON.parse(text) as Record<string, unknown> : null,
        };
      }));

      assert.deepEqual(
        signIns.map(({ status }) => status).sort((left, right) => left - right),
        [201, 500],
        "one signup should fail at short-code storage and its waiting request should recover",
      );
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.equal(
        signupTestDb.advisoryLockWaitCount,
        1,
        "both sign-ins should contend on the same provider-identity lock",
      );
      assert.equal(
        signupTestDb.activeAdvisoryLockCount,
        0,
        "the failed transaction and recovered waiter must leave no lock behind",
      );
      assert.deepEqual(signupTestDb.referralCodeInsertFailureContext, {
        accountExists: true,
        legacyCodeExists: true,
        shortCodeExists: false,
      }, "the injected short-code failure should occur after account and legacy-code writes");

      const failedSignIn = signIns.find(({ status }) => status === 500);
      const recoveredSignIn = signIns.find(({ status }) => status === 201);
      assert.ok(failedSignIn);
      assert.ok(recoveredSignIn?.body);
      assert.equal(recoveredSignIn.body.coins, 10);
      assert.equal(typeof recoveredSignIn.body.token, "string");

      const linkedAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(linkedAccounts.length, 1, "rollback and retry should leave one linked account");
      assert.equal(signupTestDb.users.size, 2, "only the seeded referrer and one Google account should remain");
      const account = linkedAccounts[0];
      assert.ok(account);
      assert.equal(account.id, recoveredSignIn.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);
      const remainingUserIds = [...signupTestDb.users.keys()].sort();
      assert.deepEqual([...signupTestDb.shortCodesByUser.keys()].sort(), remainingUserIds);
      assert.deepEqual([...signupTestDb.shortCodeOwners.values()].sort(), remainingUserIds);
      assert.deepEqual([...signupTestDb.legacyCodeOwners.values()].sort(), remainingUserIds);
      assert.equal(
        [...signupTestDb.legacyCodeOwners.values()].filter((userId) => userId === account.id).length,
        1,
        "rollback must remove the failed signup's legacy code before the waiter creates one",
      );
      assert.deepEqual(signupTestDb.referrals, [], "an un-referred signup must not create a referral");
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Welcome Signup Bonus",
        }],
        "the recovered account must receive exactly one 10-coin welcome reward",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("lowercase five-letter referral code with surrounding whitespace gives one 10-coin reward", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const pastedCode = ` \t${SIGNUP_TEST_REFERRAL_CODE.toLowerCase()} \n `;
      assert.notEqual(pastedCode.trim(), SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(
        signupTestDb.shortCodeOwners.get(SIGNUP_TEST_REFERRAL_CODE),
        [...signupTestDb.users.values()].find((user) => user.email === "referrer@example.test")?.id,
        "the fixture must register the five-letter code in the short-code lookup",
      );

      const signupResponse = await googleAuth(origin, undefined, pastedCode);
      const signup = signupResponse.body;
      assert.equal(signupResponse.status, 201);
      assert.equal(signup.coins, 10);
      assert.equal(typeof signup.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const userId = String(signup.id);
      const account = signupTestDb.users.get(userId);
      assert.ok(account, "referred Google signup should create a Daily007 account");
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 10);

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: userId,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
      );

      const signupRewards = signupTestDb.ledger.filter((entry) => entry.user_id === userId);
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
      );
      assert.equal(
        signupRewards.some((entry) => entry.reason === "Welcome Signup Bonus"),
        false,
        "a referral signup must not also receive a Welcome Signup Bonus",
      );
      assert.equal(
        signupRewards[0]?.details.referralCode,
        SIGNUP_TEST_REFERRAL_CODE,
        "the wallet record should store the canonical five-letter referral code",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.equal(walletHistory.length, 1);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("lowercase legacy referral code with surrounding whitespace gives one 10-coin reward", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const pastedLegacyCode = ` \t${SIGNUP_TEST_LEGACY_REFERRAL_CODE.toLowerCase()} \n `;
      assert.notEqual(pastedLegacyCode.trim(), SIGNUP_TEST_LEGACY_REFERRAL_CODE);
      const signupResponse = await googleAuth(
        origin,
        undefined,
        pastedLegacyCode,
      );
      const signup = signupResponse.body;
      assert.equal(signupResponse.status, 201);
      assert.equal(signup.coins, 10);
      assert.equal(typeof signup.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 1);

      const userId = String(signup.id);
      const account = signupTestDb.users.get(userId);
      assert.ok(account, "legacy referred Google signup should create a Daily007 account");
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 10);

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer, "the isolated fixture should contain the test referrer");
      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: userId,
          code: SIGNUP_TEST_LEGACY_REFERRAL_CODE,
        }],
      );

      const signupRewards = signupTestDb.ledger.filter((entry) => entry.user_id === userId);
      assert.equal(
        signupRewards[0]?.details.referralCode,
        SIGNUP_TEST_LEGACY_REFERRAL_CODE,
        "the wallet record should store the normalized legacy referral code",
      );
      assert.deepEqual(
        signupRewards.map(({ amount, balance_after, reason }) => ({
          amount,
          balance_after,
          reason,
        })),
        [{
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
      );
      assert.equal(
        signupRewards.some((entry) => entry.reason === "Welcome Signup Bonus"),
        false,
        "a legacy referral signup must not also receive a Welcome Signup Bonus",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(signup.token)}` },
      });
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletResponse.status, 200);
      assert.equal(walletHistory.length, 1);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a rejected legacy referral code lets the same Google identity retry successfully", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      assert.ok(
        SIGNUP_TEST_UNKNOWN_LEGACY_REFERRAL_CODE.length > SIGNUP_TEST_REFERRAL_CODE.length,
        "the unknown legacy-style code should be longer than a current short code",
      );
      assert.equal(
        signupTestDb.legacyCodeOwners.has(SIGNUP_TEST_UNKNOWN_LEGACY_REFERRAL_CODE),
        false,
        "the fixture must not register the unknown legacy-style code",
      );

      const response = await googleAuth(
        origin,
        undefined,
        SIGNUP_TEST_UNKNOWN_LEGACY_REFERRAL_CODE,
      );

      assert.equal(response.status, 400);
      assert.match(String(response.body.error), /referral code is not recognized/i);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.equal(signupTestDb.users.size, 1, "the seeded referrer should be the only remaining account");
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.email === "google-signup@example.test",
        ),
        false,
        "the rejected signup must not leave its account behind",
      );
      assert.equal(
        [...signupTestDb.users.values()].some(
          (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
        ),
        false,
        "the rejected signup must not leave the Google identity linked",
      );
      assert.equal(signupTestDb.referrals.length, 0, "the rejected signup must not leave a referral");
      assert.equal(signupTestDb.ledger.length, 0, "the rejected signup must not leave a signup bonus");
      assert.equal(signupTestDb.shortCodesByUser.size, 1, "the new account's short referral code must roll back");
      assert.equal(signupTestDb.shortCodeOwners.size, 1);
      assert.equal(signupTestDb.legacyCodeOwners.size, 1, "the new account's legacy referral code must roll back");

      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.equal(
        signupTestDb.shortCodeOwners.get(SIGNUP_TEST_REFERRAL_CODE),
        referrer.id,
        "the retry code must be registered and valid",
      );
      assert.equal(referrer.wallet_coins, 0);

      const retry = await googleAuth(
        origin,
        undefined,
        SIGNUP_TEST_REFERRAL_CODE,
      );
      assert.equal(retry.status, 201, "the same Google identity should be able to retry with a valid code");
      assert.equal(retry.body.coins, 10);
      assert.equal(typeof retry.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 2);

      const googleAccounts = [...signupTestDb.users.values()].filter(
        (user) => user.clerk_user_id === GOOGLE_CLERK_USER_ID,
      );
      assert.equal(googleAccounts.length, 1, "the retry should create exactly one linked account");
      assert.equal(signupTestDb.users.size, 2, "only the referrer and one Google account should exist");
      const account = googleAccounts[0];
      assert.ok(account);
      assert.equal(account.id, retry.body.id);
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 10);

      assert.deepEqual(
        signupTestDb.referrals.map(({ referrer_user_id, referred_user_id, code }) => ({
          referrer_user_id,
          referred_user_id,
          code,
        })),
        [{
          referrer_user_id: referrer.id,
          referred_user_id: account.id,
          code: SIGNUP_TEST_REFERRAL_CODE,
        }],
        "the retry should create exactly one referral relationship using the valid code",
      );
      assert.equal(signupTestDb.referrals.length, 1);
      assert.equal(signupTestDb.ledger.length, 1, "the retry should create exactly one reward ledger entry");
      assert.deepEqual(
        signupTestDb.ledger.map(({ user_id, amount, balance_after, reason }) => ({
          user_id,
          amount,
          balance_after,
          reason,
        })),
        [{
          user_id: account.id,
          amount: 10,
          balance_after: 10,
          reason: "Referral Signup Bonus",
        }],
      );
      assert.equal(signupTestDb.shortCodesByUser.size, 2);
      assert.equal(signupTestDb.shortCodeOwners.size, 2);
      assert.equal(signupTestDb.legacyCodeOwners.size, 2);

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(retry.body.token)}` },
      });
      assert.equal(walletResponse.status, 200);
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.equal(walletHistory.length, 1);
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        [{
          amount: 10,
          balanceAfter: 10,
          reason: "Referral Signup Bonus",
        }],
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a valid referral code does not change rewards when a password account links to Google", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const originalAccountId = account.id;
      const originalPassword = account.password_hash;
      const originalSalt = account.password_salt;
      const originalReferrals = structuredClone(signupTestDb.referrals);
      const originalLedger = structuredClone(signupTestDb.ledger);
      const originalSessionVersion = account.auth_version;

      const linked = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(linked.status, 200);
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.id, originalAccountId);
      assert.equal(linked.body.coins, 73);
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.id, originalAccountId);
      assert.equal(account.wallet_coins, 73);
      assert.equal(account.password_hash, originalPassword);
      assert.equal(account.password_salt, originalSalt);
      assert.equal(account.auth_version, originalSessionVersion, "explicit linking must preserve the current Daily007 session");
      assert.deepEqual(
        signupTestDb.referrals,
        originalReferrals,
        "linking with a referral code must not add referral attribution",
      );
      assert.deepEqual(
        signupTestDb.ledger,
        originalLedger,
        "linking with a referral code must not change wallet history or issue a signup reward",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the pre-link Daily007 session remains valid");

      const repeat = await googleAuth(origin);
      assert.equal(repeat.status, 200);
      assert.equal(repeat.body.id, account.id);
      assert.equal(repeat.body.coins, 73);
      assert.equal(account.wallet_coins, 73);
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a valid mixed-case verified Google email links the matching password account", async () => {
  signupTestDb.reset();
  resetMockGoogleUser({
    id: GOOGLE_CLERK_USER_ID,
    firstName: "Google",
    lastName: "Signup",
    emailAddresses: [{
      emailAddress: "Google-SignUp@Example.Test",
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "Google-SignUp@Example.Test",
      firstName: "Google",
      lastName: "Signup",
      verification: { status: "verified" },
    }],
  } as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "mixed-case-google-email-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "mixed-case-google-email-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "mixed-case-google-email-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const accountBeforeLink = structuredClone(account);
      const referralsBeforeLink = structuredClone(signupTestDb.referrals);
      const ledgerBeforeLink = structuredClone(signupTestDb.ledger);
      const accountCountBeforeLink = signupTestDb.users.size;
      const expectedWalletHistory = ledgerBeforeLink
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      const linked = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(linked.status, 200, "different email casing must not block a valid Google link");
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.id, account.id, "the existing password account should be reused");
      assert.equal(linked.body.email, account.email);
      assert.equal(linked.body.coins, 73);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(account, {
        ...accountBeforeLink,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      }, "linking should preserve the existing account and only save its Google identity");
      assert.equal(account.email, "google-signup@example.test");
      assert.equal(account.wallet_coins, 73, "linking must preserve the existing balance");
      assert.equal(signupTestDb.users.size, accountCountBeforeLink, "linking must not create a duplicate account");
      assert.deepEqual(signupTestDb.referrals, referralsBeforeLink, "linking must preserve referrals");
      assert.deepEqual(signupTestDb.ledger, ledgerBeforeLink, "linking must preserve Wallet history");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the current Daily007 session must remain usable");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
        "the Wallet history must remain visible and unchanged after linking",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a verified but malformed Google email cannot link a password account", async () => {
  signupTestDb.reset();
  resetMockGoogleUser({
    ...VERIFIED_GOOGLE_USER,
    emailAddresses: [{
      emailAddress: "google@.example.test",
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: "google@.example.test",
      firstName: "Google",
      lastName: "Signup",
      verification: { status: "verified" },
    }],
  });

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "malformed-google-email-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "malformed-google-email-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "malformed-google-email-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const accountBefore = structuredClone(account);
      const referralsBefore = structuredClone(signupTestDb.referrals);
      const ledgerBefore = structuredClone(signupTestDb.ledger);
      const userCountBefore = signupTestDb.users.size;
      const expectedWalletHistory = ledgerBefore
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      const rejectedLink = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(rejectedLink.status, 403);
      assert.equal(
        rejectedLink.body.error,
        "This Clerk account must have a Google account with a verified email address.",
      );
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(account, accountBefore, "a malformed verified email must not alter the password account");
      assert.equal(signupTestDb.users.size, userCountBefore, "rejection must not create another account");
      assert.deepEqual(signupTestDb.referrals, referralsBefore, "rejection must preserve referral relationships");
      assert.deepEqual(signupTestDb.ledger, ledgerBefore, "rejection must preserve Wallet ledger entries");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the current Daily007 session must remain active");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
        "the existing Wallet history must remain visible and unchanged",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a malformed verified email cannot sign in to an already-linked Google account", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "malformed-linked-email-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "malformed-linked-email-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "malformed-linked-email-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const linked = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(linked.status, 200, "a valid verified Google identity should link first");
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.id, account.id);
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);

      const accountAfterLink = structuredClone(account);
      const referralsAfterLink = structuredClone(signupTestDb.referrals);
      const ledgerAfterLink = structuredClone(signupTestDb.ledger);
      const accountCountAfterLink = signupTestDb.users.size;
      const expectedWalletHistory = ledgerAfterLink
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      updateMockGoogleUser({
        ...(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser),
        emailAddresses: [{
          emailAddress: "google@.example.test",
          verification: { status: "verified" },
        }],
        externalAccounts: [{
          provider: "google",
          emailAddress: "google@.example.test",
          firstName: "Google",
          lastName: "Signup",
          verification: { status: "verified" },
        }],
      });

      const rejectedSignIn = await googleAuth(origin);
      assert.equal(rejectedSignIn.status, 403);
      assert.equal(
        rejectedSignIn.body.error,
        "This Clerk account must have a Google account with a verified email address.",
      );
      assert.equal(typeof rejectedSignIn.body.token, "undefined");
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.deepEqual(account, accountAfterLink, "the saved account and Google link must remain unchanged");
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 73, "malformed provider data must not change the balance");
      assert.equal(signupTestDb.users.size, accountCountAfterLink, "rejection must not create an account");
      assert.deepEqual(signupTestDb.referrals, referralsAfterLink, "rejection must preserve referrals");
      assert.deepEqual(signupTestDb.ledger, ledgerAfterLink, "rejection must preserve Wallet history");

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the existing Daily007 session must remain active");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
        "the existing Wallet history must remain visible and unchanged",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a temporary Clerk verification outage lets a password account retry Google linking", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "clerk-outage-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "clerk-outage-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "clerk-outage-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const accountBefore = structuredClone(account);
      const referralsBefore = structuredClone(signupTestDb.referrals);
      const ledgerBefore = structuredClone(signupTestDb.ledger);
      const userCountBefore = signupTestDb.users.size;
      const expectedWalletHistory = ledgerBefore
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      failNextMockGoogleUserLookup();
      const failedLink = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(failedLink.status, 503);
      assert.equal(
        failedLink.body.error,
        "Unable to verify the Google identity with Clerk. Please try again.",
      );
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(account, accountBefore, "a temporary Clerk outage must leave the password account unchanged");
      assert.equal(signupTestDb.users.size, userCountBefore, "a failed link must not create another account");
      assert.deepEqual(signupTestDb.referrals, referralsBefore, "a failed link must preserve referrals");
      assert.deepEqual(signupTestDb.ledger, ledgerBefore, "a failed link must preserve Wallet history");

      const walletAfterFailure = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletAfterFailure.status, 200, "the current Daily007 session should survive the outage");
      const failedAttemptHistory = await walletAfterFailure.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        failedAttemptHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
      );

      const retriedLink = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(retriedLink.status, 200, "the same Daily007 session should be able to retry the link");
      assert.equal(retriedLink.body.googleLinked, true);
      assert.equal(retriedLink.body.id, account.id);
      assert.equal(retriedLink.body.coins, 73);
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.deepEqual(account, {
        ...accountBefore,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      }, "successful retry should only add the Google identity link to the account");
      assert.equal(signupTestDb.users.size, userCountBefore);
      assert.deepEqual(signupTestDb.referrals, referralsBefore);
      assert.deepEqual(signupTestDb.ledger, ledgerBefore);

      const walletAfterRetry = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletAfterRetry.status, 200, "the same Daily007 session should remain usable after linking");
      const retriedWalletHistory = await walletAfterRetry.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        retriedWalletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a Clerk lookup that never responds times out and lets Google linking be retried", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
  let releaseHangingLookup: (() => void) | undefined;

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "clerk-timeout-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "clerk-timeout-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "clerk-timeout-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const accountBefore = structuredClone(account);
      const referralsBefore = structuredClone(signupTestDb.referrals);
      const ledgerBefore = structuredClone(signupTestDb.ledger);
      const userCountBefore = signupTestDb.users.size;
      const expectedWalletHistory = ledgerBefore
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      const hangingLookup = hangNextMockGoogleUserLookup();
      releaseHangingLookup = hangingLookup.release;
      const abortController = new AbortController();
      let testGuard: ReturnType<typeof setTimeout> | undefined;
      const failedLink = await Promise.race([
        googleAuth(
          origin,
          token,
          SIGNUP_TEST_REFERRAL_CODE,
          GOOGLE_CLERK_USER_ID,
          abortController.signal,
        ),
        new Promise<never>((_resolve, reject) => {
          testGuard = setTimeout(() => {
            abortController.abort();
            reject(new Error("Google linking did not return within the test guard."));
          }, 8_000);
        }),
      ]).finally(() => {
        if (testGuard !== undefined) clearTimeout(testGuard);
      });
      assert.equal(failedLink.status, 503, "a stalled Clerk lookup should return a retryable response");
      assert.equal(
        failedLink.body.error,
        "Unable to verify the Google identity with Clerk. Please try again.",
      );
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.deepEqual(account, accountBefore, "the timeout must not alter the password account or session");
      assert.equal(signupTestDb.users.size, userCountBefore, "the timeout must not create another account");
      assert.deepEqual(signupTestDb.referrals, referralsBefore, "the timeout must preserve referral rows");
      assert.deepEqual(signupTestDb.ledger, ledgerBefore, "the timeout must preserve wallet history");

      releaseHangingLookup();
      releaseHangingLookup = undefined;

      const walletAfterTimeout = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletAfterTimeout.status, 200, "the existing password session must survive the timeout");
      const timedOutWalletHistory = await walletAfterTimeout.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        timedOutWalletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
      );

      const retriedLink = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(retriedLink.status, 200, "the password account should be able to retry linking");
      assert.equal(retriedLink.body.googleLinked, true);
      assert.equal(retriedLink.body.id, account.id);
      assert.equal(retriedLink.body.coins, 73);
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.deepEqual(account, {
        ...accountBefore,
        clerk_user_id: GOOGLE_CLERK_USER_ID,
      }, "the retry should add only the verified Google link");
      assert.equal(signupTestDb.users.size, userCountBefore);
      assert.deepEqual(signupTestDb.referrals, referralsBefore);
      assert.deepEqual(signupTestDb.ledger, ledgerBefore);

      const walletAfterRetry = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletAfterRetry.status, 200, "the same password session should remain usable after retry");
      const retriedWalletHistory = await walletAfterRetry.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        retriedWalletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
      );
    });
  } finally {
    releaseHangingLookup?.();
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a temporary Clerk outage keeps an already-linked Google sign-in retryable", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "linked-signin-outage-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "linked-signin-outage-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "linked-signin-outage-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const linked = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(linked.status, 200, "the password account should link before testing sign-in recovery");
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.id, account.id);

      const accountBeforeOutage = structuredClone(account);
      const referralsBeforeOutage = structuredClone(signupTestDb.referrals);
      const ledgerBeforeOutage = structuredClone(signupTestDb.ledger);
      const userCountBeforeOutage = signupTestDb.users.size;
      const expectedWalletHistory = ledgerBeforeOutage
        .filter(({ user_id }) => user_id === account.id)
        .map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        }));

      failNextMockGoogleUserLookup();
      const failedSignIn = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(failedSignIn.status, 503, "a temporary Clerk lookup failure should be retryable");
      assert.equal(
        failedSignIn.body.error,
        "Unable to verify the Google identity with Clerk. Please try again.",
      );
      assert.equal(typeof failedSignIn.body.token, "undefined");
      assert.equal(getMockGoogleUserLookupCount(), 2, "the failed sign-in should perform one Clerk lookup");
      assert.deepEqual(account, accountBeforeOutage, "the linked account must be unchanged during the outage");
      assert.equal(signupTestDb.users.size, userCountBeforeOutage, "the outage must not create another account");
      assert.deepEqual(signupTestDb.referrals, referralsBeforeOutage, "the outage must preserve referrals");
      assert.deepEqual(signupTestDb.ledger, ledgerBeforeOutage, "the outage must preserve Wallet history");

      const walletAfterFailure = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletAfterFailure.status, 200, "the existing password session should survive the outage");
      const failedAttemptHistory = await walletAfterFailure.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        failedAttemptHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
      );

      const retriedSignIn = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(retriedSignIn.status, 200, "the same linked Google identity should succeed after Clerk recovers");
      assert.equal(retriedSignIn.body.googleLinked, true);
      assert.equal(retriedSignIn.body.id, account.id, "retry must reuse the linked password account");
      assert.equal(retriedSignIn.body.email, account.email);
      assert.equal(retriedSignIn.body.coins, 73, "retry must return the persisted account balance");
      assert.equal(typeof retriedSignIn.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 3);
      assert.deepEqual(account, {
        ...accountBeforeOutage,
        auth_version: accountBeforeOutage.auth_version + 1,
      }, "successful retry should only advance the sign-in version");
      assert.equal(signupTestDb.users.size, userCountBeforeOutage);
      assert.deepEqual(signupTestDb.referrals, referralsBeforeOutage);
      assert.deepEqual(signupTestDb.ledger, ledgerBeforeOutage);

      const walletAfterRetry = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(retriedSignIn.body.token)}` },
      });
      assert.equal(walletAfterRetry.status, 200, "the recovered Google session should be able to read Wallet");
      const retriedWalletHistory = await walletAfterRetry.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        retriedWalletHistory.map(({ amount, balanceAfter, reason }) => ({ amount, balanceAfter, reason })),
        expectedWalletHistory,
        "the recovered sign-in should retain the linked account's Wallet history",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a linked Google identity recovers sign-in after its verified email returns to the saved address", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "linked-email-change-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "linked-email-change-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "linked-email-change-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const linked = await googleAuth(origin, token, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(linked.status, 200);
      assert.equal(linked.body.googleLinked, true);
      assert.equal(linked.body.id, account.id);
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);

      const accountAfterLink = structuredClone(account);
      const referralsAfterLink = structuredClone(signupTestDb.referrals);
      const ledgerAfterLink = structuredClone(signupTestDb.ledger);
      const accountCountAfterLink = signupTestDb.users.size;

      updateMockGoogleUser({
        ...(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser),
        emailAddresses: [{
          emailAddress: "changed-google-email@example.test",
          verification: { status: "verified" },
        }],
        externalAccounts: [{
          provider: "google",
          emailAddress: "changed-google-email@example.test",
          firstName: "Google",
          lastName: "Signup",
          verification: { status: "verified" },
        }],
      });

      const rejectedSignIn = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(rejectedSignIn.status, 409);
      assert.match(String(rejectedSignIn.body.error), /linked Google email no longer matches/i);
      assert.equal(getMockGoogleUserLookupCount(), 2);
      assert.deepEqual(account, accountAfterLink, "the existing account and Google link must remain unchanged");
      assert.equal(account.wallet_coins, 73, "the rejected sign-in must not alter the balance");
      assert.equal(signupTestDb.users.size, accountCountAfterLink, "the rejected sign-in must not create an account");
      assert.deepEqual(
        signupTestDb.referrals,
        referralsAfterLink,
        "the rejected sign-in must not change referral relationships",
      );
      assert.deepEqual(
        signupTestDb.ledger,
        ledgerAfterLink,
        "the rejected sign-in must not add, remove, or change wallet history",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the existing Daily007 session should remain usable");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        ledgerAfterLink
          .filter(({ user_id }) => user_id === account.id)
          .map(({ amount, balance_after, reason }) => ({
            amount,
            balanceAfter: balance_after,
            reason,
          })),
      );

      updateMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);
      const restoredSignIn = await googleAuth(origin, undefined, SIGNUP_TEST_REFERRAL_CODE);
      assert.equal(restoredSignIn.status, 200,
        "the linked Google identity should sign in after its verified email returns to the saved address");
      assert.equal(restoredSignIn.body.googleLinked, true);
      assert.equal(restoredSignIn.body.id, account.id);
      assert.equal(restoredSignIn.body.email, account.email);
      assert.equal(restoredSignIn.body.coins, 73,
        "restoring the verified email should return the existing account balance");
      assert.equal(typeof restoredSignIn.body.token, "string");
      assert.equal(getMockGoogleUserLookupCount(), 3);
      assert.deepEqual(account, {
        ...accountAfterLink,
        auth_version: accountAfterLink.auth_version + 1,
      }, "successful recovery should keep the account and wallet, advancing only its sign-in version");
      assert.equal(signupTestDb.users.size, accountCountAfterLink,
        "restored Google sign-in should reuse the existing account");
      assert.deepEqual(signupTestDb.referrals, referralsAfterLink,
        "restored Google sign-in should preserve referral relationships");
      assert.deepEqual(signupTestDb.ledger, ledgerAfterLink,
        "restored Google sign-in should not add, remove, or alter wallet entries");

      const restoredWalletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${String(restoredSignIn.body.token)}` },
      });
      assert.equal(restoredWalletResponse.status, 200,
        "the token returned after email restoration should access Wallet");
      const restoredWalletHistory = await restoredWalletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        restoredWalletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        ledgerAfterLink
          .filter(({ user_id }) => user_id === account.id)
          .map(({ amount, balance_after, reason }) => ({
            amount,
            balanceAfter: balance_after,
            reason,
          })),
        "the restored Google session should retain the existing Wallet history",
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a verified Google email mismatch cannot link an account or change its rewards", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(MISMATCHED_VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(
        origin,
        "google-signup@example.test",
      );
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      assert.equal(
        signupTestDb.shortCodeOwners.get(SIGNUP_TEST_REFERRAL_CODE),
        referrer.id,
        "the supplied referral code must be valid",
      );
      signupTestDb.referrals.push({
        id: "existing-email-mismatch-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "existing-email-mismatch-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "existing-email-mismatch-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const balanceBeforeLinkAttempt = account.wallet_coins;
      const referralsBeforeLinkAttempt = structuredClone(signupTestDb.referrals);
      const ledgerBeforeLinkAttempt = structuredClone(signupTestDb.ledger);
      const accountCountBeforeLinkAttempt = signupTestDb.users.size;
      const authVersionBeforeLinkAttempt = account.auth_version;
      assert.notEqual(account.email, "different-google-signup@example.test");

      const rejectedLink = await googleAuth(
        origin,
        token,
        SIGNUP_TEST_REFERRAL_CODE,
      );

      assert.equal(rejectedLink.status, 409);
      assert.match(String(rejectedLink.body.error), /verified Google email must match/i);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.equal(account.clerk_user_id, null, "the mismatched Google identity must remain unlinked");
      assert.equal(account.wallet_coins, balanceBeforeLinkAttempt);
      assert.equal(account.auth_version, authVersionBeforeLinkAttempt);
      assert.equal(signupTestDb.users.size, accountCountBeforeLinkAttempt);
      assert.deepEqual(
        signupTestDb.referrals,
        referralsBeforeLinkAttempt,
        "the supplied referral code must not change referral relationships",
      );
      assert.deepEqual(
        signupTestDb.ledger,
        ledgerBeforeLinkAttempt,
        "the mismatched link must not change wallet history or rewards",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(walletResponse.status, 200, "the current Daily007 session should remain valid");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        ledgerBeforeLinkAttempt.map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        })),
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("unverified Google identities cannot link a password account or change its rewards", async (t) => {
  const unverifiedIdentities = [
    {
      name: "an unverified Google external account",
      user: {
        ...VERIFIED_GOOGLE_USER,
        externalAccounts: [{
          ...VERIFIED_GOOGLE_USER.externalAccounts[0],
          verification: { status: "unverified" },
        }],
      },
    },
    {
      name: "an unverified Clerk email",
      user: {
        ...VERIFIED_GOOGLE_USER,
        emailAddresses: [{
          ...VERIFIED_GOOGLE_USER.emailAddresses[0],
          verification: { status: "unverified" },
        }],
      },
    },
  ];

  for (const scenario of unverifiedIdentities) {
    await t.test(scenario.name, async () => {
      signupTestDb.reset();
      resetMockGoogleUser(scenario.user as unknown as MockGoogleUser);

      try {
        await withGoogleAuthServer(async (origin) => {
          const { account, token } = await createPasswordAccount(
            origin,
            "google-signup@example.test",
          );
          account.wallet_coins = 73;
          const referrer = [...signupTestDb.users.values()].find(
            (user) => user.email === "referrer@example.test",
          );
          assert.ok(referrer);
          assert.equal(
            signupTestDb.shortCodeOwners.get(SIGNUP_TEST_REFERRAL_CODE),
            referrer.id,
            "the supplied referral code must be valid",
          );
          signupTestDb.referrals.push({
            id: `unverified-link-${scenario.name}`,
            referrer_user_id: referrer.id,
            referred_user_id: account.id,
            code: SIGNUP_TEST_REFERRAL_CODE,
          });
          signupTestDb.ledger.push({
            id: `unverified-link-${scenario.name}-wallet-entry`,
            user_id: account.id,
            amount: 73,
            balance_after: 73,
            reason: "Wallet Recharge",
            idempotency_key: `unverified-link-${scenario.name}-wallet-entry`,
            details: { source: "test fixture" },
            created_at: new Date(1),
          });

          const accountBeforeLinkAttempt = structuredClone(account);
          const referralsBeforeLinkAttempt = structuredClone(signupTestDb.referrals);
          const ledgerBeforeLinkAttempt = structuredClone(signupTestDb.ledger);
          const accountCountBeforeLinkAttempt = signupTestDb.users.size;

          const rejectedLink = await googleAuth(
            origin,
            token,
            SIGNUP_TEST_REFERRAL_CODE,
          );

          assert.equal(rejectedLink.status, 403);
          assert.match(String(rejectedLink.body.error), /verified email address/i);
          assert.equal(getMockGoogleUserLookupCount(), 1);
          assert.deepEqual(account, accountBeforeLinkAttempt, "the password account must remain unchanged");
          assert.equal(account.clerk_user_id, null, "the unverified Google identity must remain unlinked");
          assert.equal(account.wallet_coins, 73, "the rejected link must not alter the balance");
          assert.equal(signupTestDb.users.size, accountCountBeforeLinkAttempt, "the request must not create an account");
          assert.deepEqual(
            signupTestDb.referrals,
            referralsBeforeLinkAttempt,
            "the supplied referral code must not change referral relationships",
          );
          assert.deepEqual(
            signupTestDb.ledger,
            ledgerBeforeLinkAttempt,
            "the rejected link must not change wallet history or rewards",
          );

          const walletResponse = await fetch(`${origin}/wallet/transactions`, {
            headers: { authorization: `Bearer ${token}` },
          });
          assert.equal(walletResponse.status, 200, "the current Daily007 session should remain valid");
          const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
          assert.deepEqual(
            walletHistory.map(({ amount, balanceAfter, reason }) => ({
              amount,
              balanceAfter,
              reason,
            })),
            ledgerBeforeLinkAttempt.map(({ amount, balance_after, reason }) => ({
              amount,
              balanceAfter: balance_after,
              reason,
            })),
            "the Wallet API must continue to return the original history",
          );
        });
      } finally {
        signupTestDb.reset();
        resetMockGoogleUser();
      }
    });
  }
});

test("a replaced Daily007 session cannot link Google or change the account's rewards", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token: staleToken } = await createPasswordAccount(
        origin,
        "google-signup@example.test",
      );
      account.wallet_coins = 73;
      const referrer = [...signupTestDb.users.values()].find(
        (user) => user.email === "referrer@example.test",
      );
      assert.ok(referrer);
      signupTestDb.referrals.push({
        id: "existing-stale-link-referral",
        referrer_user_id: referrer.id,
        referred_user_id: account.id,
        code: SIGNUP_TEST_REFERRAL_CODE,
      });
      signupTestDb.ledger.push({
        id: "existing-stale-link-wallet-entry",
        user_id: account.id,
        amount: 73,
        balance_after: 73,
        reason: "Wallet Recharge",
        idempotency_key: "existing-stale-link-wallet-entry",
        details: { source: "test fixture" },
        created_at: new Date(1),
      });

      const replacementLogin = await postJson(origin, "/daily007/v2/auth/login", {
        email: "google-signup@example.test",
        password: "google-link-test-password",
      });
      assert.equal(replacementLogin.status, 200, "a second sign-in should replace the first session");
      const replacementToken = String(replacementLogin.body.token);
      assert.notEqual(replacementToken, staleToken);

      const balanceBeforeLinkAttempt = account.wallet_coins;
      const referralsBeforeLinkAttempt = structuredClone(signupTestDb.referrals);
      const ledgerBeforeLinkAttempt = structuredClone(signupTestDb.ledger);
      const accountCountBeforeLinkAttempt = signupTestDb.users.size;
      const authVersionBeforeLinkAttempt = account.auth_version;

      const staleLink = await googleAuth(
        origin,
        staleToken,
        SIGNUP_TEST_REFERRAL_CODE,
      );

      assert.equal(staleLink.status, 401);
      assert.match(String(staleLink.body.error), /session was replaced by a newer sign-in/i);
      assert.equal(getMockGoogleUserLookupCount(), 1);
      assert.equal(account.clerk_user_id, null, "the stale session must not link Google");
      assert.equal(account.wallet_coins, balanceBeforeLinkAttempt);
      assert.equal(account.auth_version, authVersionBeforeLinkAttempt);
      assert.equal(signupTestDb.users.size, accountCountBeforeLinkAttempt);
      assert.deepEqual(
        signupTestDb.referrals,
        referralsBeforeLinkAttempt,
        "a rejected link must not change referral relationships",
      );
      assert.deepEqual(
        signupTestDb.ledger,
        ledgerBeforeLinkAttempt,
        "a rejected link must not add, remove, or change wallet history",
      );

      const walletResponse = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: `Bearer ${replacementToken}` },
      });
      assert.equal(walletResponse.status, 200, "the replacement session should remain active");
      const walletHistory = await walletResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(
        walletHistory.map(({ amount, balanceAfter, reason }) => ({
          amount,
          balanceAfter,
          reason,
        })),
        ledgerBeforeLinkAttempt.map(({ amount, balance_after, reason }) => ({
          amount,
          balanceAfter: balance_after,
          reason,
        })),
      );
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("a logged-out Google identity cannot claim a password account or access its Wallet", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 47;
      const originalSessionVersion = account.auth_version;

      // No X-Daily007-Token represents a signed-out player attempting Google sign-in.
      const takeover = await googleAuth(origin);
      assert.equal(takeover.status, 409);
      assert.match(String(takeover.body.error), /sign in with your password/i);
      assert.equal(account.clerk_user_id, null, "matching email alone must not link Google");
      assert.equal(account.wallet_coins, 47, "a rejected link must not alter the wallet");
      assert.equal(account.auth_version, originalSessionVersion);

      const walletResponse = await fetch(`${origin}/wallet/transactions`);
      assert.equal(walletResponse.status, 401, "a logged-out player cannot read the protected Wallet API");
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});

test("logout clears the Daily007 session even if Clerk sign-out fails", async () => {
  const calls: string[] = [];
  let daily007Session: { token: string } | null = { token: "active-session" };
  let sessionWasClearedBeforeClerkSignOut = false;
  const clerkSignOutFailed = await logoutDaily007(
    async () => {
      calls.push("clerk");
      sessionWasClearedBeforeClerkSignOut = daily007Session === null;
      throw new Error("simulated Clerk sign-out failure");
    },
    () => {
      calls.push("daily007-session");
      daily007Session = null;
    },
  );
  assert.equal(clerkSignOutFailed, true);
  assert.deepEqual(calls, ["daily007-session", "clerk"]);
  assert.equal(sessionWasClearedBeforeClerkSignOut, true);
  assert.equal(daily007Session, null, "Clerk failure must not restore the Daily007 session.");

  calls.length = 0;
  daily007Session = { token: "active-session" };
  sessionWasClearedBeforeClerkSignOut = false;
  const success = await logoutDaily007(
    async () => {
      calls.push("clerk");
      sessionWasClearedBeforeClerkSignOut = daily007Session === null;
    },
    () => {
      calls.push("daily007-session");
      daily007Session = null;
    },
  );
  assert.equal(success, false);
  assert.deepEqual(calls, ["daily007-session", "clerk"]);
  assert.equal(sessionWasClearedBeforeClerkSignOut, true);
  assert.equal(daily007Session, null);
});

test("blocked Google-linked Daily007 accounts are denied sign-in", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account } = await createPasswordAccount(origin, "google-signup@example.test");
      account.clerk_user_id = GOOGLE_CLERK_USER_ID;
      account.status = "blocked";
      const originalSessionVersion = account.auth_version;
      const originalWallet = account.wallet_coins;

      const blocked = await googleAuth(origin);
      assert.equal(blocked.status, 403);
      assert.match(String(blocked.body.error), /account is blocked/i);
      assert.equal(typeof blocked.body.token, "undefined");
      assert.equal(account.auth_version, originalSessionVersion);
      assert.equal(account.wallet_coins, originalWallet);
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});