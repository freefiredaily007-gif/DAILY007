import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getSSOCallbackMessage,
  runGoogleSSOFlow,
} from "../src/lib/google-sso-flow.ts";

function createSession(id, events, token = "verified-clerk-jwt") {
  return {
    id,
    async getToken() {
      events.push(`token:${id}`);
      return token;
    },
  };
}

test("fresh OAuth activates and verifies the returned session before exchanging its Clerk token", async () => {
  const events = [];
  let activeSession = null;
  const createdSession = createSession("fresh-session", events);
  const result = await runGoogleSSOFlow({
    getActiveSession() {
      events.push("read-active-session");
      return activeSession;
    },
    async startSSOFlow() {
      events.push("start-oauth");
      return {
        createdSessionId: "fresh-session",
        async setActive({ session }) {
          events.push(`activate:${session}:start`);
          await Promise.resolve();
          activeSession = createdSession;
          events.push(`activate:${session}:complete`);
        },
      };
    },
    async exchangeToken(token) {
      events.push(`exchange:${token}`);
      assert.equal(activeSession?.id, "fresh-session");
      return { account: "daily007-player" };
    },
  });

  assert.deepEqual(result, {
    status: "success",
    value: { account: "daily007-player" },
  });
  assert.deepEqual(events, [
    "read-active-session",
    "start-oauth",
    "activate:fresh-session:start",
    "activate:fresh-session:complete",
    "read-active-session",
    "token:fresh-session",
    "exchange:verified-clerk-jwt",
  ]);
});

test("an existing Clerk session is reused without starting another OAuth flow", async () => {
  const events = [];
  const existingSession = createSession("saved-session", events);
  const result = await runGoogleSSOFlow({
    getActiveSession() {
      events.push("read-active-session");
      return existingSession;
    },
    async startSSOFlow() {
      assert.fail("OAuth should not start when a Clerk session already exists");
    },
    async exchangeToken(token) {
      events.push(`exchange:${token}`);
      return "signed-in";
    },
  });

  assert.deepEqual(result, { status: "success", value: "signed-in" });
  assert.deepEqual(events, [
    "read-active-session",
    "read-active-session",
    "token:saved-session",
    "exchange:verified-clerk-jwt",
  ]);
});

test("cancellation and dismissal return quietly without a token exchange", async () => {
  for (const type of ["cancel", "dismiss"]) {
    let exchanges = 0;
    const result = await runGoogleSSOFlow({
      getActiveSession: () => null,
      async startSSOFlow() {
        return { authSessionResult: { type } };
      },
      async exchangeToken() {
        exchanges += 1;
      },
    });

    assert.deepEqual(result, { status: "cancelled" }, type);
    assert.equal(exchanges, 0, type);
  }
});

test("a missing active Clerk session after activation is a retryable error", async () => {
  let exchanges = 0;
  const result = await runGoogleSSOFlow({
    getActiveSession: () => null,
    async startSSOFlow() {
      return {
        createdSessionId: "expected-session",
        async setActive() {},
      };
    },
    async exchangeToken() {
      exchanges += 1;
    },
  });

  assert.deepEqual(result, {
    status: "error",
    message: "Google sign-in finished, but Clerk did not activate the expected session. Please try again.",
  });
  assert.equal(exchanges, 0);
});

test("a mismatched active Clerk session is a retryable error", async () => {
  const events = [];
  const wrongSession = createSession("other-session", events);
  let reads = 0;
  let exchanges = 0;
  const result = await runGoogleSSOFlow({
    getActiveSession() {
      reads += 1;
      return reads === 1 ? null : wrongSession;
    },
    async startSSOFlow() {
      return {
        createdSessionId: "expected-session",
        async setActive() {},
      };
    },
    async exchangeToken() {
      exchanges += 1;
    },
  });

  assert.deepEqual(result, {
    status: "error",
    message: "Google sign-in finished, but Clerk did not activate the expected session. Please try again.",
  });
  assert.deepEqual(events, []);
  assert.equal(exchanges, 0);
});

test("an active Clerk session without a verified token is not exchanged with the API", async () => {
  const events = [];
  const activeSession = createSession("active-session", events, null);
  let exchanges = 0;
  const result = await runGoogleSSOFlow({
    getActiveSession: () => activeSession,
    async startSSOFlow() {
      assert.fail("OAuth should not start when a Clerk session already exists");
    },
    async exchangeToken() {
      exchanges += 1;
    },
  });

  assert.deepEqual(result, {
    status: "error",
    message: "Google sign-in completed, but a verified Clerk session token was not available. Please try again.",
  });
  assert.deepEqual(events, ["token:active-session"]);
  assert.equal(exchanges, 0);
});

test("callback messages give clear success or retry guidance on web, Android, and iOS", () => {
  assert.match(getSSOCallbackMessage("web", "success"), /sign-in is complete/i);
  assert.match(getSSOCallbackMessage("web", "dismiss"), /try again/i);
  for (const platform of ["android", "ios"]) {
    const message = getSSOCallbackMessage(platform);
    assert.match(message, /return to the app/i, platform);
    assert.match(message, /try again/i, platform);
  }
});

test("the React Native button and callback route use the isolated handoff and message logic", async () => {
  const buttonSource = await readFile(
    new URL("../src/components/GoogleSSOButton.tsx", import.meta.url),
    "utf8",
  );
  const callbackSource = await readFile(
    new URL("../app/sso-callback.tsx", import.meta.url),
    "utf8",
  );

  assert.match(buttonSource, /runGoogleSSOFlow\(/);
  assert.match(buttonSource, /getActiveSession:\s*\(\)\s*=>\s*getClerkInstance\(\)\.session/);
  assert.match(buttonSource, /strategy:\s*'oauth_google'/);
  assert.match(buttonSource, /AuthSession\.makeRedirectUri\(\{ scheme: 'daily007', path: 'sso-callback' \}\)/);
  assert.match(buttonSource, /exchangeToken:\s*\(clerkJwt\)\s*=>\s*Api\.googleAuth\(clerkJwt/);
  assert.match(callbackSource, /getSSOCallbackMessage\(Platform\.OS,\s*authCompletion\?\.type\)/);
  assert.match(callbackSource, /Platform\.OS === 'web'[\s\S]*?WebBrowser\.maybeCompleteAuthSession\(\)/);
});
