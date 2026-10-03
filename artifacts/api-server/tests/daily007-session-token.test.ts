import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isSessionVersionCurrent,
  makeToken,
  readSessionToken,
  readToken,
} from "../src/lib/daily007-session-token.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";

test("session tokens carry the server-controlled version", () => {
  const previousSecret = process.env.DAILY007_AUTH_SECRET;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.DAILY007_AUTH_SECRET = "test-session-secret-that-is-long-enough";
  delete process.env.SESSION_SECRET;
  try {
    const token = makeToken(USER_ID, 7);
    assert.ok(token);
    assert.deepEqual(readSessionToken(token), { userId: USER_ID, sessionVersion: 7 });
    assert.equal(readToken(token), USER_ID);
    assert.equal(isSessionVersionCurrent(7, 7), true);
    assert.equal(isSessionVersionCurrent(6, 7), false);
    assert.equal(isSessionVersionCurrent(7, "7"), false);
  } finally {
    if (previousSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousSecret;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});

test("pre-version Daily007 tokens remain version zero until the account signs in again", () => {
  const previousSecret = process.env.DAILY007_AUTH_SECRET;
  const previousSessionSecret = process.env.SESSION_SECRET;
  const secret = "test-session-secret-that-is-long-enough";
  process.env.DAILY007_AUTH_SECRET = secret;
  delete process.env.SESSION_SECRET;
  try {
    const payload = Buffer.from(JSON.stringify({
      sub: USER_ID,
      exp: Math.floor(Date.now() / 1000) + 60,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const claims = readSessionToken(`${payload}.${signature}`);
    assert.deepEqual(claims, { userId: USER_ID, sessionVersion: 0 });
    assert.equal(isSessionVersionCurrent(claims!.sessionVersion, 0), true);
    assert.equal(isSessionVersionCurrent(claims!.sessionVersion, 1), false);
  } finally {
    if (previousSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousSecret;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});

test("invalid session versions and signatures are rejected", () => {
  const previousSecret = process.env.DAILY007_AUTH_SECRET;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.DAILY007_AUTH_SECRET = "test-session-secret-that-is-long-enough";
  delete process.env.SESSION_SECRET;
  try {
    assert.equal(makeToken(USER_ID, -1), null);
    assert.equal(makeToken(USER_ID, Number.MAX_SAFE_INTEGER + 1), null);
    const token = makeToken(USER_ID, 2);
    assert.ok(token);
    assert.equal(readSessionToken(`${token.slice(0, -1)}x`), null);
    assert.equal(readSessionToken(`${token}.extra`), null);
  } finally {
    if (previousSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousSecret;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});