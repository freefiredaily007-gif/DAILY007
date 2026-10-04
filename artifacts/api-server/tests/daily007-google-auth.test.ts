import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import test, { after } from "node:test";
import type { User } from "@clerk/express";
import daily007GoogleAuthRouter from "../src/routes/daily007-google-auth";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  chooseGoogleAccountAction,
  verifiedGoogleIdentity,
} from "../src/lib/daily007-google-auth-validation.ts";
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

test("a new Google account receives one 10-coin signup reward visible in Wallet history", async () => {
  signupTestDb.reset();
  resetMockGoogleUser(VERIFIED_GOOGLE_USER as unknown as MockGoogleUser);

  try {
    await withGoogleAuthServer(async (origin) => {
      const signupResponse = await fetch(`${origin}/auth/google`, {
        method: "POST",
        headers: {
          authorization: "Bearer mocked-clerk-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const signup = await signupResponse.json() as Record<string, unknown>;

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
    });
  } finally {
    signupTestDb.reset();
    resetMockGoogleUser();
  }
});