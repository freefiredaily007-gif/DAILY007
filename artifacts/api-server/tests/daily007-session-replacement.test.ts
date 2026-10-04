import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import { signupTestDb } from "./support/daily007-signup-test-db";

const TEST_AUTH_SECRET = "session-replacement-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  signupTestDb.reset();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
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

function makeLegacyToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60,
  })).toString("base64url");
  const signature = createHmac("sha256", TEST_AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

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