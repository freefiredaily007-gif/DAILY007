import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import {
  getSSOCallbackMessage,
  runGoogleSSOAttempt,
  runGoogleSSOFlow,
} from "../src/lib/google-sso-flow.ts";

mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    async getItem() {
      return null;
    },
    async setItem() {},
    async removeItem() {},
  },
});
mock.module("@workspace/api-client-react", {
  namedExports: { setAuthExpiredHandler() {} },
});
mock.module("expo-constants", {
  defaultExport: { expoConfig: null },
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z\d]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { Api, http, setSession } = await import("../src/lib/api.ts");

async function withCapturedGoogleRequests(savedDaily007Token, run) {
  const requests = [];
  const previousAdapter = http.defaults.adapter;
  await setSession(savedDaily007Token ? { id: "saved-player", token: savedDaily007Token } : null);
  http.defaults.adapter = async (config) => {
    requests.push(config);
    return {
      data: {
        success: true,
        data: {
          id: "daily007-player",
          email: "player@example.test",
          token: "returned-daily007-token",
        },
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };

  try {
    await run(requests);
  } finally {
    http.defaults.adapter = previousAdapter;
    await setSession(null);
  }
}

function headerValue(headers, name) {
  return headers.get(name) ?? headers[name];
}

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

test("cancellation and dismissal restore the Google button without reporting an outcome", async () => {
  for (const type of ["cancel", "dismiss"]) {
    let loading = false;
    const loadingChanges = [];
    const errors = [];
    const successes = [];
    let exchanges = 0;

    await runGoogleSSOAttempt({
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: () => null,
        async startSSOFlow() {
          return { authSessionResult: { type } };
        },
        async exchangeToken() {
          exchanges += 1;
          return "unexpected";
        },
      }),
      setLoading(value) {
        loading = value;
        loadingChanges.push(value);
      },
      showError: (message) => errors.push(message),
      onSuccess: (value) => successes.push(value),
      getErrorMessage: (error) => `${error.message}. Please try again.`,
    });

    assert.equal(loading, false, type);
    assert.deepEqual(loadingChanges, [true, false], type);
    assert.deepEqual(errors, [], type);
    assert.deepEqual(successes, [], type);
    assert.equal(exchanges, 0, type);
  }
});

test("Google sign-in can be retried after the account picker is dismissed", async () => {
  const loadingChanges = [];
  const errors = [];
  const successes = [];
  const providerStarts = [];
  const events = [];
  let loading = false;
  let errorMessage = "";
  let providerAttempts = 0;
  let activeSession = null;

  async function attemptSignIn() {
    errorMessage = "";
    await runGoogleSSOAttempt({
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: () => activeSession,
        async startSSOFlow() {
          providerAttempts += 1;
          providerStarts.push({ attempt: providerAttempts, loading, errorMessage });
          if (providerAttempts === 1) {
            return { authSessionResult: { type: "dismiss" } };
          }

          return {
            createdSessionId: "retry-session",
            async setActive({ session }) {
              activeSession = createSession(session, events);
            },
          };
        },
        async exchangeToken(token) {
          events.push(`exchange:${token}`);
          return { account: "daily007-player" };
        },
      }),
      setLoading(value) {
        loading = value;
        loadingChanges.push(value);
      },
      showError(message) {
        errorMessage = message;
        errors.push(message);
      },
      onSuccess: (value) => successes.push(value),
      getErrorMessage: (error) => `${error.message}. Please try again.`,
    });
  }

  await attemptSignIn();
  assert.equal(loading, false);
  assert.equal(errorMessage, "");
  assert.deepEqual(errors, []);
  assert.deepEqual(successes, []);
  assert.equal(providerAttempts, 1);

  await attemptSignIn();
  assert.equal(loading, false);
  assert.equal(errorMessage, "");
  assert.equal(providerAttempts, 2);
  assert.deepEqual(loadingChanges, [true, false, true, false]);
  assert.deepEqual(providerStarts, [
    { attempt: 1, loading: true, errorMessage: "" },
    { attempt: 2, loading: true, errorMessage: "" },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(successes, [{ account: "daily007-player" }]);
  assert.deepEqual(events, [
    "token:retry-session",
    "exchange:verified-clerk-jwt",
  ]);
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

test("a rejected Clerk activation restores the Google button and reports a retryable error", async () => {
  const loadingChanges = [];
  const errors = [];
  const attemptEvents = [];
  let successCalls = 0;
  let exchanges = 0;
  const result = await runGoogleSSOAttempt({
    authenticate: () => runGoogleSSOFlow({
      getActiveSession: () => null,
      async startSSOFlow() {
        return {
          createdSessionId: "fresh-session",
          async setActive() {
            throw new Error("Clerk activation failed");
          },
        };
      },
      async exchangeToken() {
        exchanges += 1;
        return "unexpected";
      },
    }),
    setLoading: (loading) => {
      loadingChanges.push(loading);
      attemptEvents.push(`loading:${loading}`);
    },
    showError: (message) => {
      errors.push(message);
      attemptEvents.push(`error:${message}`);
    },
    onSuccess: () => {
      successCalls += 1;
    },
    getErrorMessage: (error) => `${error.message}. Please try again.`,
  });

  assert.equal(result, undefined);
  assert.deepEqual(loadingChanges, [true, false]);
  assert.deepEqual(errors, ["Clerk activation failed. Please try again."]);
  assert.deepEqual(
    attemptEvents,
    ["loading:true", "loading:false", "error:Clerk activation failed. Please try again."],
  );
  assert.equal(exchanges, 0);
  assert.equal(successCalls, 0);
});

test("a rejected Daily007 token exchange restores the Google button and reports a retryable error", async () => {
  const loadingChanges = [];
  const errors = [];
  const attemptEvents = [];
  let successCalls = 0;
  const result = await runGoogleSSOAttempt({
    authenticate: () => runGoogleSSOFlow({
      getActiveSession: () => createSession("active-session", []),
      async startSSOFlow() {
        assert.fail("OAuth should not start when a Clerk session already exists");
      },
      async exchangeToken() {
        throw new Error("Daily007 is temporarily unavailable");
      },
    }),
    setLoading: (loading) => {
      loadingChanges.push(loading);
      attemptEvents.push(`loading:${loading}`);
    },
    showError: (message) => {
      errors.push(message);
      attemptEvents.push(`error:${message}`);
    },
    onSuccess: () => {
      successCalls += 1;
    },
    getErrorMessage: (error) => `${error.message}. Please try again.`,
  });

  assert.equal(result, undefined);
  assert.deepEqual(loadingChanges, [true, false]);
  assert.deepEqual(errors, ["Daily007 is temporarily unavailable. Please try again."]);
  assert.deepEqual(
    attemptEvents,
    ["loading:true", "loading:false", "error:Daily007 is temporarily unavailable. Please try again."],
  );
  assert.equal(successCalls, 0);
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

test("Google sign-in sends Clerk authorization and keeps the Daily007 link token separate", async () => {
  const clerkJwt = "verified-clerk-jwt";
  const daily007Token = "existing-daily007-token";

  await withCapturedGoogleRequests(daily007Token, async (requests) => {
    await Api.googleAuth(clerkJwt, { dailyToken: daily007Token });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/auth/google");
    assert.equal(
      headerValue(requests[0].headers, "Authorization"),
      `Bearer ${clerkJwt}`,
    );
    assert.equal(
      headerValue(requests[0].headers, "X-Daily007-Token"),
      daily007Token,
    );
    assert.notEqual(
      headerValue(requests[0].headers, "Authorization"),
      `Bearer ${daily007Token}`,
    );
  });
});

test("Google sign-in omits the Daily007 link header when no saved token is provided", async () => {
  await withCapturedGoogleRequests(null, async (requests) => {
    await Api.googleAuth("verified-clerk-jwt");

    assert.equal(requests.length, 1);
    assert.equal(
      headerValue(requests[0].headers, "Authorization"),
      "Bearer verified-clerk-jwt",
    );
    assert.equal(headerValue(requests[0].headers, "X-Daily007-Token"), undefined);
  });
});

test("Google sign-in makes no API request with an empty Clerk token", async () => {
  await withCapturedGoogleRequests("existing-daily007-token", async (requests) => {
    await assert.rejects(
      Api.googleAuth("", { dailyToken: "existing-daily007-token" }),
      /did not return a verified Clerk session/i,
    );

    assert.equal(requests.length, 0);
  });
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
  const authSource = await readFile(
    new URL("../src/screens/Auth.tsx", import.meta.url),
    "utf8",
  );
  const uiSource = await readFile(
    new URL("../src/components/ui.tsx", import.meta.url),
    "utf8",
  );
  const callbackSource = await readFile(
    new URL("../app/sso-callback.tsx", import.meta.url),
    "utf8",
  );

  assert.match(buttonSource, /runGoogleSSOAttempt\(/);
  assert.match(buttonSource, /authenticate:\s*\(\)\s*=>\s*runGoogleSSOFlow\(/);
  assert.match(buttonSource, /setLoading:\s*setBusy/);
  assert.match(buttonSource, /disabled=\{disabled \|\| loading\}/);
  assert.match(buttonSource, /getErrorMessage:\s*\(e\)\s*=>/);
  assert.match(buttonSource, /return `\$\{message\} Please try again\.`/);
  assert.match(buttonSource, /onError && Platform\.OS === 'android'[\s\S]*?AccessibilityInfo\.announceForAccessibility\(message\)/);
  assert.equal(
    (buttonSource.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length,
    1,
    "Google errors should have one direct Android announcement",
  );
  assert.match(buttonSource, /accessibilityLabel=\{error\}[\s\S]*?accessibilityLiveRegion="assertive"/);
  const authGoogleError = authSource.match(/\{googleErr\s*\? <Msg[\s\S]*?text=\{googleErr\}[\s\S]*?\/>[\s\S]*?: null\}/);
  assert.ok(authGoogleError, "login screen should display Google errors");
  assert.match(
    authGoogleError[0],
    /accessibilityLiveRegion=\{Platform\.OS === 'android' \? undefined : 'assertive'\}/,
  );
  assert.match(authSource, /onError=\{\(message\) => \{\s*setErr\(''\);\s*setGoogleErr\(message\);\s*\}\}/);
  assert.match(authSource, /accessibilityLiveRegion=\{err \? 'assertive' : undefined\}/);
  assert.match(uiSource, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.match(buttonSource, /getActiveSession:\s*\(\)\s*=>\s*getClerkInstance\(\)\.session/);
  assert.match(buttonSource, /strategy:\s*'oauth_google'/);
  assert.match(buttonSource, /AuthSession\.makeRedirectUri\(\{ scheme: 'daily007', path: 'sso-callback' \}\)/);
  assert.match(buttonSource, /exchangeToken:\s*\(clerkJwt\)\s*=>\s*Api\.googleAuth\(clerkJwt/);
  assert.match(callbackSource, /getSSOCallbackMessage\(Platform\.OS,\s*authCompletion\?\.type\)/);
  assert.match(callbackSource, /Platform\.OS === 'web'[\s\S]*?WebBrowser\.maybeCompleteAuthSession\(\)/);
});
