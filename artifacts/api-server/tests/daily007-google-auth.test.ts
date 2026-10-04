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
import { logoutDaily007 } from "../../daily007/src/lib/logout";
import {
  getMockGoogleUserLookupCount,
  resetMockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";
import type { User as MockGoogleUser } from "./support/daily007-google-auth-clerk-mock";
import { signupTestDb } from "./support/daily007-signup-test-db";

const GOOGLE_CLERK_USER_ID = "clerk-google-signup-test";
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
    Object.assign(req, { auth: { userId: GOOGLE_CLERK_USER_ID } });
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

type JsonResult = { status: number; body: Record<string, any> };

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
  return { status: response.status, body: await response.json() };
}

function googleAuth(origin: string, dailyToken?: string): Promise<JsonResult> {
  return postJson(origin, "/auth/google", {}, {
    authorization: "Bearer mocked-clerk-session",
    ...(dailyToken ? { "X-Daily007-Token": dailyToken } : {}),
  });
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

test("an existing password account links to Google only with its current Daily007 session", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const { account, token } = await createPasswordAccount(origin, "google-signup@example.test");
      account.wallet_coins = 73;
      const originalPassword = account.password_hash;
      const originalSalt = account.password_salt;
      const originalLedgerCount = signupTestDb.ledger.length;
      const originalSessionVersion = account.auth_version;

      const linked = await googleAuth(origin, token);
      assert.equal(linked.status, 200);
      assert.equal(linked.body.id, account.id);
      assert.equal(linked.body.coins, 73);
      assert.equal(account.clerk_user_id, GOOGLE_CLERK_USER_ID);
      assert.equal(account.wallet_coins, 73);
      assert.equal(account.password_hash, originalPassword);
      assert.equal(account.password_salt, originalSalt);
      assert.equal(account.auth_version, originalSessionVersion, "explicit linking must preserve the current Daily007 session");
      assert.equal(signupTestDb.ledger.length, originalLedgerCount, "linking must not grant a second signup reward");

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
  const clerkSignOutFailed = await logoutDaily007(
    async () => { calls.push("clerk"); throw new Error("simulated Clerk sign-out failure"); },
    () => { calls.push("daily007-session"); },
  );
  assert.equal(clerkSignOutFailed, true);
  assert.deepEqual(calls, ["clerk", "daily007-session"]);

  calls.length = 0;
  const success = await logoutDaily007(
    async () => { calls.push("clerk"); },
    () => { calls.push("daily007-session"); },
  );
  assert.equal(success, false);
  assert.deepEqual(calls, ["clerk", "daily007-session"]);
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