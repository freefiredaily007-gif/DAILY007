import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import daily007V2Router from "../src/routes/daily007-v2";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  SIGNUP_TEST_REFERRAL_CODE,
  signupTestDb,
} from "./support/daily007-signup-test-db";

const TEST_AUTH_SECRET = "signup-wallet-flow-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
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

async function request(
  origin: string,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  token?: string,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("password signup returns one 10-coin bonus through wallet history, and repeat sign-in adds none", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const signupCases = [
      {
        label: "non-referred",
        email: "welcome@example.test",
        reason: "Welcome Signup Bonus",
      },
      {
        label: "referred",
        email: "referral@example.test",
        referralCode: SIGNUP_TEST_REFERRAL_CODE,
        reason: "Referral Signup Bonus",
      },
    ];

    for (const signupCase of signupCases) {
      const password = "test-password-123";
      const registration = await request(
        origin,
        "/daily007/v2/auth/register",
        "POST",
        {
          name: `${signupCase.label} player`,
          email: signupCase.email,
          password,
          ...(signupCase.referralCode ? { referralCode: signupCase.referralCode } : {}),
        },
      );

      assert.equal(registration.status, 201);
      assert.equal(registration.body.account.wallet_coins, 10);
      assert.equal(typeof registration.body.token, "string");
      const accountId = registration.body.account.id as string;

      const historyAfterSignup = await request(
        origin,
        "/wallet/transactions",
        "GET",
        undefined,
        registration.body.token,
      );
      assert.equal(historyAfterSignup.status, 200);
      assert.equal(historyAfterSignup.body.length, 1);
      assert.deepEqual(
        historyAfterSignup.body.map((entry: any) => ({
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          reason: entry.reason,
        })),
        [{ amount: 10, balanceAfter: 10, reason: signupCase.reason }],
      );

      const login = await request(origin, "/daily007/v2/auth/login", "POST", {
        email: signupCase.email,
        password,
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.account.wallet_coins, 10);
      assert.notEqual(login.body.token, registration.body.token);

      const historyAfterLogin = await request(
        origin,
        "/wallet/transactions",
        "GET",
        undefined,
        login.body.token,
      );
      assert.equal(historyAfterLogin.status, 200);
      assert.equal(historyAfterLogin.body.length, 1);
      assert.deepEqual(
        historyAfterLogin.body.map((entry: any) => ({
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          reason: entry.reason,
        })),
        [{ amount: 10, balanceAfter: 10, reason: signupCase.reason }],
      );
      assert.equal(signupTestDb.users.get(accountId)?.wallet_coins, 10);
      assert.equal(
        signupTestDb.ledger.filter((entry) => entry.user_id === accountId).length,
        1,
      );
    }

    assert.equal(signupTestDb.referrals.length, 1);
    assert.equal(signupTestDb.ledger.length, 2);
  });
});

test("unknown referral code rolls back signup so the same email can register with a valid code", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "retry-after-invalid-referral@example.test";
    const invalidRegistration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      {
        name: "Retry referral player",
        email,
        password: "test-password-123",
        referralCode: "NOTREAL",
      },
    );

    assert.equal(invalidRegistration.status, 400);
    assert.deepEqual(invalidRegistration.body, {
      error: "Referral code is not recognized.",
    });
    assert.equal([...signupTestDb.users.values()].some((user) => user.email === email), false);
    assert.equal(signupTestDb.users.size, 1);
    assert.equal(signupTestDb.shortCodesByUser.size, 1);
    assert.equal(signupTestDb.shortCodeOwners.size, 1);
    assert.equal(signupTestDb.referrals.length, 0);
    assert.equal(signupTestDb.ledger.length, 0);

    const validRegistration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      {
        name: "Retry referral player",
        email,
        password: "test-password-123",
        referralCode: SIGNUP_TEST_REFERRAL_CODE,
      },
    );

    assert.equal(validRegistration.status, 201);
    assert.equal(validRegistration.body.account.email, email);
    assert.equal(validRegistration.body.account.wallet_coins, 10);
    const accountId = validRegistration.body.account.id as string;
    assert.equal(signupTestDb.users.get(accountId)?.email, email);
    assert.equal(signupTestDb.referrals.length, 1);
    assert.equal(signupTestDb.referrals[0]?.referred_user_id, accountId);
    assert.equal(signupTestDb.ledger.length, 1);
    assert.equal(signupTestDb.ledger[0]?.user_id, accountId);
  });
});