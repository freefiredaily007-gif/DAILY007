import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import {
  createDaily007LoginThrottle,
  DAILY007_LOGIN_ATTEMPT_LIMIT,
  DAILY007_LOGIN_RATE_LIMIT_MESSAGE,
} from "../src/lib/daily007-login-throttle";
import { verifyDaily007LoginPassword } from "../src/lib/daily007-login-password";
import { signupTestDb } from "./support/daily007-signup-test-db";

const TEST_AUTH_SECRET = "session-replacement-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;
let requestIpSequence = 0;

after(() => {
  signupTestDb.reset();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any; retryAfter: string | null };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);

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
  clientIp = `192.0.2.${++requestIpSequence}`,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-forwarded-for": clientIp,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    retryAfter: response.headers.get("retry-after"),
  };
}

async function waitForAuthVersionUpdatePause(
  reached: Promise<void>,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reached.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function makeLegacyToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60,
  })).toString("base64url");
  const signature = createHmac("sha256", TEST_AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("unknown-email and wrong-password login checks each hash exactly once", async () => {
  const hashCalls: Array<{ password: string; salt: Buffer }> = [];
  const hashPassword = async (password: string, salt?: Buffer) => {
    assert.ok(salt);
    hashCalls.push({ password, salt: Buffer.from(salt) });
    return { salt: salt.toString("hex"), hash: Buffer.alloc(64, 3).toString("hex") };
  };
  const storedCredentials = {
    password_salt: Buffer.alloc(16, 1).toString("hex"),
    password_hash: Buffer.alloc(64, 2).toString("hex"),
  };

  assert.equal(
    await verifyDaily007LoginPassword("same-password", null, hashPassword),
    false,
    "unknown email must never authenticate",
  );
  assert.equal(hashCalls.length, 1, "unknown email must perform one password hash");
  assert.equal(hashCalls[0].password, "same-password");
  assert.deepEqual(hashCalls[0].salt, Buffer.alloc(16));

  assert.equal(
    await verifyDaily007LoginPassword("wrong-password", storedCredentials, hashPassword),
    false,
    "wrong password must not authenticate",
  );
  assert.equal(hashCalls.length, 2, "wrong password must perform one password hash");
  assert.equal(hashCalls[1].password, "wrong-password");
  assert.deepEqual(hashCalls[1].salt, Buffer.from(storedCredentials.password_salt, "hex"));
});

test("login throttling recovers after its short window and is isolated by client IP", async () => {
  signupTestDb.reset();
  const throttle = createDaily007LoginThrottle({
    limit: 2,
    windowMs: 1_000,
  });

  assert.deepEqual(await throttle.consume("192.0.2.10"), { allowed: true });
  assert.deepEqual(await throttle.consume("192.0.2.10"), { allowed: true });
  assert.deepEqual(
    await throttle.consume("192.0.2.10"),
    { allowed: false, retryAfterSeconds: 1 },
  );
  assert.deepEqual(await throttle.consume("192.0.2.11"), { allowed: true });

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.deepEqual(
    await throttle.consume("192.0.2.10"),
    { allowed: true },
    "the same client can try again when the window expires",
  );
});

test("a burst from one client IP cannot exceed the configured login limit", async () => {
  signupTestDb.reset();
  const throttle = createDaily007LoginThrottle({
    limit: 3,
    windowMs: 1_000,
  });
  const results = await Promise.all(Array.from(
    { length: 12 },
    () => throttle.consume("192.0.2.12"),
  ));

  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed).length, 9);
});

test("both password-login routes share the same IP limit for known and unknown emails", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "login-throttle-test@example.test";
    const password = "login-throttle-test-password";
    const registration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      { name: "Login Throttle Test", email, password },
    );
    assert.equal(registration.status, 201);

    const clientIp = "198.51.100.40";
    const loginRoutes = [
      "/daily007/v2/auth/login",
      "/auth/login",
    ];

    for (let attempt = 0; attempt < DAILY007_LOGIN_ATTEMPT_LIMIT; attempt += 1) {
      const knownEmail = attempt % 2 === 0;
      const response = await request(
        origin,
        loginRoutes[attempt % loginRoutes.length]!,
        "POST",
        {
          email: knownEmail ? email : "unknown-login-throttle@example.test",
          password: `${password}-incorrect`,
        },
        undefined,
        clientIp,
      );
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "Email or password is incorrect.");
    }

    const limitedKnownEmail = await request(
      origin,
      loginRoutes[0]!,
      "POST",
      { email, password: `${password}-incorrect` },
      undefined,
      clientIp,
    );
    const limitedUnknownEmail = await request(
      origin,
      loginRoutes[1]!,
      "POST",
      { email: "unknown-login-throttle@example.test", password },
      undefined,
      clientIp,
    );

    assert.equal(limitedKnownEmail.status, 429);
    assert.equal(limitedUnknownEmail.status, 429);
    assert.deepEqual(
      limitedKnownEmail.body,
      { error: DAILY007_LOGIN_RATE_LIMIT_MESSAGE },
    );
    assert.deepEqual(limitedUnknownEmail.body, limitedKnownEmail.body);
    assert.ok(Number(limitedKnownEmail.retryAfter) > 0);
    assert.ok(Number(limitedKnownEmail.retryAfter) <= 60);
    assert.ok(Number(limitedUnknownEmail.retryAfter) > 0);
    assert.ok(Number(limitedUnknownEmail.retryAfter) <= 60);

    const loginFromAnotherIp = await request(
      origin,
      loginRoutes[1]!,
      "POST",
      { email, password },
      undefined,
      "198.51.100.41",
    );
    assert.equal(
      loginFromAnotherIp.status,
      200,
      "rate-limiting one client IP must not lock the account for other players",
    );
  });
});

test("unknown emails, wrong passwords, and blocked accounts share one public login error", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "login-error-test@example.test";
    const password = "login-error-regression-password";
    const registration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      { name: "Login Error Test", email, password },
    );

    assert.equal(registration.status, 201);

    const loginRoutes = [
      { label: "Daily007 v2", loginPath: "/daily007/v2/auth/login" },
      { label: "compatibility", loginPath: "/auth/login" },
    ];
    const unknownEmailResponses: JsonResult[] = [];

    for (const route of loginRoutes) {
      const unknownEmail = await request(origin, route.loginPath, "POST", {
        email: "unknown-login-error-test@example.test",
        password,
      });
      const wrongPassword = await request(origin, route.loginPath, "POST", {
        email,
        password: `${password}-incorrect`,
      });

      assert.equal(unknownEmail.status, 401, `${route.label} unknown email should be rejected`);
      assert.equal(wrongPassword.status, 401, `${route.label} wrong password should be rejected`);
      assert.equal(
        unknownEmail.status,
        wrongPassword.status,
        `${route.label} must not expose whether the email is registered through the status`,
      );
      assert.equal(
        unknownEmail.body.error,
        "Email or password is incorrect.",
        `${route.label} unknown-email public error`,
      );
      assert.equal(
        wrongPassword.body.error,
        unknownEmail.body.error,
        `${route.label} must return the same public error for both failures`,
      );
      unknownEmailResponses.push(unknownEmail);
    }

    const blockedAccount = [...signupTestDb.users.values()].find((user) => user.email === email);
    assert.ok(blockedAccount, "the test signup should exist in the isolated signup database");
    blockedAccount.status = "blocked";

    for (const [index, route] of loginRoutes.entries()) {
      const blockedLogin = await request(origin, route.loginPath, "POST", {
        email,
        password,
      });
      assert.equal(blockedLogin.status, 401, `${route.label} blocked account should be rejected generically`);
      assert.deepEqual(
        blockedLogin.body,
        unknownEmailResponses[index]?.body,
        `${route.label} must not reveal that this blocked email belongs to an account`,
      );
    }
    assert.equal(blockedAccount.auth_version, 0, "blocked login attempts must not create or rotate a session");
  });
});

test("a block during password login prevents both routes from creating a session", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "login-block-race-test@example.test";
    const password = "login-block-race-regression-password";
    const registration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      { name: "Login Block Race Test", email, password },
    );
    assert.equal(registration.status, 201);

    const account = [...signupTestDb.users.values()].find(
      (user) => user.email === email,
    );
    assert.ok(
      account,
      "the test signup should exist in the isolated signup database",
    );
    const loginRoutes = [
      { label: "Daily007 v2", loginPath: "/daily007/v2/auth/login" },
      { label: "compatibility", loginPath: "/auth/login" },
    ];

    for (const route of loginRoutes) {
      account.status = "active";
      const unknownEmail = await request(origin, route.loginPath, "POST", {
        email: "unknown-login-block-race@example.test",
        password,
      });
      assert.equal(
        unknownEmail.status,
        401,
        `${route.label} unknown email should be rejected`,
      );

      const pause = signupTestDb.pauseNextAuthVersionUpdate();
      let loginPromise: Promise<JsonResult> | undefined;
      let pausedAtUpdate = false;
      try {
        loginPromise = request(origin, route.loginPath, "POST", {
          email,
          password,
        });
        pausedAtUpdate = await waitForAuthVersionUpdatePause(pause.reached);
        if (pausedAtUpdate) account.status = "blocked";
      } finally {
        pause.release();
      }

      assert.ok(
        loginPromise,
        `${route.label} login request should have started`,
      );
      const blockedLogin = await loginPromise;
      assert.equal(
        pausedAtUpdate,
        true,
        `${route.label} login should pause before rotating auth_version`,
      );
      assert.equal(blockedLogin.status, unknownEmail.status);
      assert.deepEqual(
        blockedLogin.body,
        unknownEmail.body,
        `${route.label} must use the same public response as an unknown email`,
      );
      assert.equal(
        blockedLogin.body.token,
        undefined,
        `${route.label} must not issue a token`,
      );
      assert.equal(account.status, "blocked");
      assert.equal(
        account.auth_version,
        0,
        `${route.label} must not rotate auth_version`,
      );
    }
  });
});

test("a pre-rollout token stays valid until the account's next successful password login", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "legacy-session@example.test";
    const password = "legacy-session-regression-password";
    const registration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      { name: "Legacy Session Test", email, password },
    );

    assert.equal(registration.status, 201);
    const accountId = registration.body.account.id as string;
    assert.equal(signupTestDb.users.get(accountId)?.auth_version, 0);

    const legacyToken = makeLegacyToken(accountId);
    const legacyClaims = JSON.parse(Buffer.from(legacyToken.split(".")[0], "base64url").toString("utf8"));
    assert.equal("sv" in legacyClaims, false, "legacy token must not contain a session-version claim");

    const beforeLogin = await request(
      origin,
      "/daily007/v2/auth/me",
      "GET",
      undefined,
      legacyToken,
    );
    assert.equal(beforeLogin.status, 200, "pre-rollout token should work while auth_version is zero");
    assert.equal(beforeLogin.body.id, accountId);

    const failedLogin = await request(
      origin,
      "/daily007/v2/auth/login",
      "POST",
      { email, password: `${password}-incorrect` },
    );
    assert.equal(failedLogin.status, 401);
    assert.equal(signupTestDb.users.get(accountId)?.auth_version, 0);

    const afterFailedLogin = await request(
      origin,
      "/daily007/v2/auth/me",
      "GET",
      undefined,
      legacyToken,
    );
    assert.equal(afterFailedLogin.status, 200, "a rejected password attempt must not replace a legacy session");

    const login = await request(
      origin,
      "/daily007/v2/auth/login",
      "POST",
      { email, password },
    );
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, "string");
    assert.equal(signupTestDb.users.get(accountId)?.auth_version, 1);

    const oldSession = await request(
      origin,
      "/daily007/v2/auth/me",
      "GET",
      undefined,
      legacyToken,
    );
    assert.equal(oldSession.status, 401, "successful sign-in should replace the pre-rollout token");

    const newSession = await request(
      origin,
      "/daily007/v2/auth/me",
      "GET",
      undefined,
      login.body.token,
    );
    assert.equal(newSession.status, 200, "token from the successful sign-in should remain valid");
    assert.equal(newSession.body.id, accountId);
  });
});

test("authenticated current-account routes report Google linkage without changing account identity", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const registration = await request(origin, "/auth/register", "POST", {
      name: "Google Link Status Test",
      email: "google-link-status@example.test",
      password: "google-link-status-password",
    });
    assert.equal(registration.status, 201);
    const accountId = registration.body.id as string;
    const token = registration.body.token as string;
    const account = signupTestDb.users.get(accountId);
    assert.ok(account);
    const accountCoins = account.wallet_coins;
    const sessionVersion = account.auth_version;
    const currentAccountPaths = ["/auth/me", "/daily007/v2/auth/me"];

    for (const path of currentAccountPaths) {
      const response = await request(origin, path, "GET", undefined, token);
      assert.equal(response.status, 200, `${path} should return the authenticated account`);
      assert.equal(response.body.googleLinked, false, `${path} should report an unlinked password account`);
      assert.equal(response.body.id, accountId, `${path} should preserve the Daily007 account`);
      assert.equal(response.body.coins, accountCoins, `${path} should preserve the wallet balance`);
      assert.equal(response.body.walletCoins, accountCoins, `${path} should preserve the wallet balance`);
      assert.equal(response.body.clerk_user_id, undefined, `${path} must not expose the Google provider ID`);
    }

    account.clerk_user_id = "google-link-status-provider-id";

    for (const path of currentAccountPaths) {
      const response = await request(origin, path, "GET", undefined, token);
      assert.equal(response.status, 200, `${path} should accept the original Daily007 token`);
      assert.equal(response.body.googleLinked, true, `${path} should report the linked Google account`);
      assert.equal(response.body.id, accountId, `${path} should preserve the Daily007 account`);
      assert.equal(response.body.coins, accountCoins, `${path} should preserve the wallet balance`);
      assert.equal(response.body.walletCoins, accountCoins, `${path} should preserve the wallet balance`);
      assert.equal(response.body.clerk_user_id, undefined, `${path} must not expose the Google provider ID`);
    }

    assert.equal(account.id, accountId);
    assert.equal(account.wallet_coins, accountCoins);
    assert.equal(account.auth_version, sessionVersion, "reading Google linkage must not replace the Daily007 token");
    assert.equal(token, registration.body.token, "the session token must remain unchanged");
  });
});

test("wrong passwords preserve a valid session while successful logins replace it", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const email = "session-replacement@example.test";
    const password = "session-regression-password";
    const registration = await request(
      origin,
      "/daily007/v2/auth/register",
      "POST",
      { name: "Session Test", email, password },
    );

    assert.equal(registration.status, 201);
    const accountId = registration.body.account.id as string;

    const loginRoutes = [
      {
        label: "Daily007 v2",
        loginPath: "/daily007/v2/auth/login",
        mePath: "/daily007/v2/auth/me",
      },
      {
        label: "compatibility",
        loginPath: "/auth/login",
        mePath: "/auth/me",
      },
    ];

    for (const route of loginRoutes) {
      const firstLogin = await request(origin, route.loginPath, "POST", { email, password });
      assert.equal(firstLogin.status, 200, `${route.label} first login`);
      assert.equal(typeof firstLogin.body.token, "string");

      const authVersionAfterSuccessfulLogin = signupTestDb.users.get(accountId)?.auth_version;
      const failedLogin = await request(
        origin,
        route.loginPath,
        "POST",
        { email, password: `${password}-incorrect` },
      );
      assert.equal(failedLogin.status, 401, `${route.label} incorrect password should be rejected`);
      assert.match(String(failedLogin.body.error), /incorrect/i);
      assert.equal(
        signupTestDb.users.get(accountId)?.auth_version,
        authVersionAfterSuccessfulLogin,
        `${route.label} failed login must not advance the session version`,
      );

      const sessionAfterFailedLogin = await request(
        origin,
        route.mePath,
        "GET",
        undefined,
        firstLogin.body.token,
      );
      assert.equal(
        sessionAfterFailedLogin.status,
        200,
        `${route.label} original token should remain valid after a wrong password`,
      );
      assert.equal(sessionAfterFailedLogin.body.id, accountId);

      const secondLogin = await request(origin, route.loginPath, "POST", { email, password });
      assert.equal(secondLogin.status, 200, `${route.label} second login`);
      assert.equal(typeof secondLogin.body.token, "string");
      assert.notEqual(secondLogin.body.token, firstLogin.body.token);

      const staleSession = await request(
        origin,
        route.mePath,
        "GET",
        undefined,
        firstLogin.body.token,
      );
      assert.equal(staleSession.status, 401, `${route.label} old token should be rejected`);

      const currentSession = await request(
        origin,
        route.mePath,
        "GET",
        undefined,
        secondLogin.body.token,
      );
      assert.equal(currentSession.status, 200, `${route.label} new token should remain valid`);
      assert.equal(currentSession.body.id, accountId);
    }

    assert.equal(signupTestDb.users.get(accountId)?.auth_version, loginRoutes.length * 2);
  });
});