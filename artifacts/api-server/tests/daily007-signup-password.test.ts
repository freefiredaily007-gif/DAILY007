import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import {
  SIGNUP_PASSWORD_LENGTH_ERROR,
  signupPasswordError,
} from "../../daily007/src/lib/signup-password-policy";
import compatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "registration-password-tests-only-secret-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type HttpResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(compatCoreRouter);

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

async function register(
  origin: string,
  path: string,
  email: string,
  password: string,
): Promise<HttpResult> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Password Test", email, password }),
  });
  return { status: response.status, body: await response.json() };
}

test("signup form password validation accepts 8–200 characters", () => {
  assert.equal(signupPasswordError("x".repeat(7)), SIGNUP_PASSWORD_LENGTH_ERROR);
  assert.equal(signupPasswordError("x".repeat(8)), null);
  assert.equal(signupPasswordError("x".repeat(200)), null);
  assert.equal(signupPasswordError("x".repeat(201)), SIGNUP_PASSWORD_LENGTH_ERROR);
});

const registrationEndpoints = [
  { label: "Daily007 v2", path: "/daily007/v2/auth/register" },
  { label: "compatibility", path: "/auth/register" },
];

for (const endpoint of registrationEndpoints) {
  test(`${endpoint.label} signup accepts 8 and 200 characters and rejects 7 and 201`, async () => {
    await withServer(async (origin) => {
      const short = await register(
        origin,
        endpoint.path,
        `${endpoint.label.replaceAll(" ", "-")}-short@example.test`,
        "x".repeat(7),
      );
      assert.equal(short.status, 400);
      assert.equal(short.body.error, SIGNUP_PASSWORD_LENGTH_ERROR);

      for (const length of [8, 200]) {
        const accepted = await register(
          origin,
          endpoint.path,
          `${endpoint.label.replaceAll(" ", "-")}-${length}@example.test`,
          "x".repeat(length),
        );
        assert.equal(accepted.status, 201);
        assert.equal(typeof accepted.body.token, "string");
      }

      const tooLong = await register(
        origin,
        endpoint.path,
        `${endpoint.label.replaceAll(" ", "-")}-too-long@example.test`,
        "x".repeat(201),
      );
      assert.equal(tooLong.status, 400);
      assert.equal(tooLong.body.error, SIGNUP_PASSWORD_LENGTH_ERROR);
    });
  });
}