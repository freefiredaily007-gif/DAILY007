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

test("Google sign-in can be retried after the provider rejects an attempt", async () => {
  const loadingChanges = [];
  const errors = [];
  const successes = [];
  const providerStarts = [];
  const events = [];
  const inFlight = { current: false };
  let loading = false;
  let errorMessage = "";
  let providerAttempts = 0;
  let activeSession = null;

  async function attemptSignIn() {
    await runGoogleSSOAttempt({
      inFlight,
      onStart() {
        errorMessage = "";
      },
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: () => activeSession,
        async startSSOFlow() {
          providerAttempts += 1;
          providerStarts.push({ attempt: providerAttempts, loading, errorMessage });
          if (providerAttempts === 1) {
            throw new Error("Google provider rejected the request");
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
  assert.equal(inFlight.current, false);
  assert.equal(errorMessage, "Google provider rejected the request. Please try again.");
  assert.deepEqual(errors, ["Google provider rejected the request. Please try again."]);
  assert.deepEqual(successes, []);
  assert.equal(providerAttempts, 1);

  await attemptSignIn();
  assert.equal(loading, false);
  assert.equal(inFlight.current, false);
  assert.equal(errorMessage, "");
  assert.equal(providerAttempts, 2);
  assert.deepEqual(loadingChanges, [true, false, true, false]);
  assert.deepEqual(providerStarts, [
    { attempt: 1, loading: true, errorMessage: "" },
    { attempt: 2, loading: true, errorMessage: "" },
  ]);
  assert.deepEqual(errors, ["Google provider rejected the request. Please try again."]);
  assert.deepEqual(successes, [{ account: "daily007-player" }]);
  assert.deepEqual(events, [
    "token:retry-session",
    "exchange:verified-clerk-jwt",
  ]);
});

test("Google sign-in can be retried when Clerk token retrieval rejects", async () => {
  const loadingChanges = [];
  const errors = [];
  const successes = [];
  const events = [];
  const inFlight = { current: false };
  let loading = false;
  let errorMessage = "";
  let tokenAttempts = 0;
  let providerAttempts = 0;
  let activeSession = null;

  async function attemptSignIn() {
    await runGoogleSSOAttempt({
      inFlight,
      onStart() {
        errorMessage = "";
      },
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: () => activeSession,
        async startSSOFlow() {
          providerAttempts += 1;
          events.push("start-oauth");
          return {
            createdSessionId: "retry-session",
            async setActive({ session }) {
              events.push(`activate:${session}`);
              activeSession = {
                id: session,
                async getToken() {
                  tokenAttempts += 1;
                  events.push(`token:${session}:${tokenAttempts}`);
                  if (tokenAttempts === 1) {
                    throw new Error("Clerk token retrieval is temporarily unavailable");
                  }
                  return "verified-clerk-jwt";
                },
              };
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
  assert.equal(inFlight.current, false);
  assert.equal(
    errorMessage,
    "Clerk token retrieval is temporarily unavailable. Please try again.",
  );
  assert.deepEqual(errors, [
    "Clerk token retrieval is temporarily unavailable. Please try again.",
  ]);
  assert.deepEqual(successes, []);
  assert.equal(providerAttempts, 1);

  await attemptSignIn();
  assert.equal(loading, false);
  assert.equal(inFlight.current, false);
  assert.equal(errorMessage, "");
  assert.deepEqual(loadingChanges, [true, false, true, false]);
  assert.deepEqual(errors, [
    "Clerk token retrieval is temporarily unavailable. Please try again.",
  ]);
  assert.deepEqual(successes, [{ account: "daily007-player" }]);
  assert.equal(providerAttempts, 1, "retry should reuse the activated Clerk session");
  assert.deepEqual(events, [
    "start-oauth",
    "activate:retry-session",
    "token:retry-session:1",
    "token:retry-session:2",
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

test("Profile Google-link provider and server failures announce once and preserve the password session", async () => {
  const profileSource = await readFile(
    new URL("../src/screens/Profile.tsx", import.meta.url),
    "utf8",
  );
  const buttonSource = await readFile(
    new URL("../src/components/GoogleSSOButton.tsx", import.meta.url),
    "utf8",
  );
  const profileButton = profileSource.match(
    /<GoogleSSOButton\s+label="Connect Google"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(profileButton, "Profile should render its Google-link button");
  assert.match(profileButton, /dailyToken=\{user\.token\}/);
  assert.match(profileButton, /onError=\{setGoogleLinkError\}/);
  assert.match(
    profileSource,
    /\{!!googleLinkError && <Text style=\{s\.statsError\}>{googleLinkError}<\/Text>\}/,
    "Profile should display the same error without adding a second live-region announcement",
  );
  assert.doesNotMatch(
    profileSource.match(/\{!!googleLinkError[\s\S]*?\}/)?.[0] ?? "",
    /accessibilityLiveRegion/,
  );
  assert.match(
    buttonSource,
    /const showError = \(message: string\) => \{\s*setError\(message\);\s*reportGoogleError\(onError, message\);/,
  );
  assert.match(
    buttonSource,
    /setLoading: \(isBusy\) => \{\s*setBusy\(isBusy\);\s*onBusyChange\?\.\(isBusy\);/,
  );

  const savedPasswordSession = { token: "existing-daily007-password-token" };
  const scenarios = [
    {
      label: "provider",
      error: "Google provider request failed",
      getActiveSession: () => null,
      async startSSOFlow() {
        throw new Error("Google provider request failed");
      },
      async exchangeToken() {
        assert.fail("the API must not be called after a provider failure");
      },
    },
    {
      label: "Daily007 server",
      error: "Daily007 server unavailable",
      getActiveSession: () => createSession("google-session", []),
      async startSSOFlow() {
        assert.fail("the existing Google session should be reused");
      },
      async exchangeToken() {
        throw new Error("Daily007 server unavailable");
      },
    },
  ];

  for (const scenario of scenarios) {
    const loadingChanges = [];
    const errors = [];
    await runGoogleSSOAttempt({
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: scenario.getActiveSession,
        startSSOFlow: scenario.startSSOFlow,
        exchangeToken: scenario.exchangeToken,
      }),
      setLoading: (loading) => loadingChanges.push(loading),
      showError: (message) => errors.push(message),
      onSuccess: () => {
        savedPasswordSession.token = "unexpectedly-replaced-token";
      },
      getErrorMessage: (error) => `${error.message}. Please try again.`,
    });

    assert.deepEqual(loadingChanges, [true, false], `${scenario.label} failure should restore retry`);
    assert.deepEqual(errors, [`${scenario.error}. Please try again.`]);
    assert.equal(errors.length, 1, `${scenario.label} failure should be reported once`);
    assert.equal(
      savedPasswordSession.token,
      "existing-daily007-password-token",
      `${scenario.label} failure must preserve the existing Daily007 password session`,
    );
  }
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

test("Google signup retries a corrected referral code with the same active Clerk session", async () => {
  const requests = [];
  const previousAdapter = http.defaults.adapter;
  const errors = [];
  const successes = [];
  const activeSession = createSession("active-google-session", [], "verified-clerk-jwt");
  const loadingStates = [];
  await setSession(null);
  http.defaults.adapter = async (config) => {
    requests.push(config);
    if (requests.length === 1) {
      const response = {
        status: 422,
        data: { error: "Referral code is invalid" },
        config,
      };
      return Promise.reject(Object.assign(new Error("Request failed with status code 422"), {
        config,
        response,
      }));
    }

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

  async function retryWithReferral(referralCode) {
    await runGoogleSSOAttempt({
      authenticate: () => runGoogleSSOFlow({
        getActiveSession: () => activeSession,
        async startSSOFlow() {
          assert.fail("retry should reuse the active Clerk session");
        },
        exchangeToken: (clerkJwt) => Api.googleAuth(clerkJwt, { referralCode }),
      }),
      setLoading: (loading) => loadingStates.push(loading),
      showError: (message) => errors.push(message),
      onSuccess: (value) => successes.push(value),
      getErrorMessage: (error) => error?.response?.data?.error ?? error.message,
    });
  }

  try {
    await retryWithReferral("BAD00");
    assert.deepEqual(errors, ["Referral code is invalid"]);
    assert.deepEqual(successes, []);
    assert.deepEqual(loadingStates, [true, false],
      "the rejected signup should clear loading so the Google action can be retried");

    await retryWithReferral("GOOD7");
    assert.deepEqual(errors, ["Referral code is invalid"]);
    assert.equal(successes.length, 1);
    assert.equal(successes[0].user.id, "daily007-player");
    assert.deepEqual(loadingStates, [true, false, true, false]);

    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests.map(({ data }) => typeof data === "string" ? JSON.parse(data) : data),
      [{ referralCode: "BAD00" }, { referralCode: "GOOD7" }],
    );
    assert.deepEqual(
      requests.map(({ headers }) => headerValue(headers, "Authorization")),
      ["Bearer verified-clerk-jwt", "Bearer verified-clerk-jwt"],
    );
  } finally {
    http.defaults.adapter = previousAdapter;
    await setSession(null);
  }
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
  assert.match(buttonSource, /inFlight:\s*googleAttemptInFlight/);
  assert.match(buttonSource, /onStart:\s*\(\)\s*=>\s*\{\s*setError\(''\);\s*onError\?\.\(''\);/);
  assert.match(buttonSource, /authenticate:\s*\(\)\s*=>\s*runGoogleSSOFlow\(/);
  assert.match(
    buttonSource,
    /setLoading:\s*\(isBusy\)\s*=>\s*\{\s*setBusy\(isBusy\);\s*onBusyChange\?\.\(isBusy\);/,
  );
  assert.match(buttonSource, /accessibilityState=\{\{ disabled: !!disabled \|\| !!loading, busy: !!loading \}\}/);
  assert.match(buttonSource, /aria-busy=\{!!loading\}/);
  assert.match(buttonSource, /accessibilityRole="button"/,
    "TalkBack should expose Google sign-up as an actionable button");
  assert.match(buttonSource, /accessibilityLabel=\{loading \? `\$\{label\}\. Connecting to Google\. Please wait\.` : label\}/);
  assert.match(authSource, /label=\{mode === 'signup' \? 'Sign up with Google' : 'Continue with Google'\}/,
    "TalkBack should identify the retry action as Google sign-up");
  assert.match(buttonSource, /if \(!disabled && !loading\) onPress\(\);/,
    "a completed rejection should leave the Google retry action pressable");
  assert.match(buttonSource, /if \(isBusy\) announceGoogleStatus\('Connecting to Google\. Please wait\.'\)/);
  assert.match(buttonSource, /announceGoogleStatus\([\s\S]*?'Google sign-up complete\.'/);
  assert.match(buttonSource, /getErrorMessage:\s*\(e\)\s*=>/);
  assert.match(buttonSource, /return `\$\{message\} Please try again\.`/);
  assert.match(buttonSource, /if \(Platform\.OS !== 'web'\) \{\s*AccessibilityInfo\.announceForAccessibility\(message\);/);
  const googleErrorReporter = buttonSource.match(/function reportGoogleError\([\s\S]*?\n\}/)?.[0];
  assert.ok(googleErrorReporter, "Google errors should use the shared error reporter");
  assert.equal(
    (googleErrorReporter.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length,
    1,
    "Google errors should have one direct native announcement",
  );
  assert.match(
    buttonSource,
    /accessibilityLabel=\{error\}[\s\S]*?accessibilityLiveRegion=\{Platform\.OS === 'web' \? 'assertive' : undefined\}/,
  );
  const authGoogleError = authSource.match(/\{googleErr\s*\? <Msg[\s\S]*?text=\{googleErr\}[\s\S]*?\/>[\s\S]*?: null\}/);
  assert.ok(authGoogleError, "login screen should display Google errors");
  assert.match(
    authGoogleError[0],
    /accessibilityLiveRegion=\{Platform\.OS === 'web' \? 'assertive' : undefined\}/,
  );
  assert.match(
    authSource,
    /onError=\{\(message\) => \{\s*setErr\(''\);\s*setGoogleErr\(message\);\s*setReferralCodeApplied\(false\);\s*\}\}/,
  );
  assert.match(
    authSource,
    /accessibilityLiveRegion=\{err && !\(Platform\.OS === 'android' && sessionSaveError\)\s*\?\s*'assertive'\s*:\s*undefined\}/,
    "Android's session-save announcement should not be duplicated by its live region",
  );
  assert.match(uiSource, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.match(buttonSource, /getActiveSession=\{\(\) => getClerkInstance\(\)\.session\}/);
  assert.match(buttonSource, /strategy:\s*'oauth_google'/);
  assert.match(buttonSource, /AuthSession\.makeRedirectUri\(\{ scheme: 'daily007', path: 'sso-callback' \}\)/);
  assert.match(buttonSource, /exchangeToken:\s*\(clerkJwt\)\s*=>\s*Api\.googleAuth\(clerkJwt/);
  assert.match(
    buttonSource,
    /\.\.\.\(referralCode\?\.trim\(\)\s*\?\s*\{\s*referralCode:\s*referralCode\.trim\(\)\s*\}\s*:\s*\{\}\)/,
    "each Google attempt should send the current editable referral code",
  );
  assert.match(
    authSource,
    /<Input\s+ref=\{referralInputRef\}[\s\S]*?testID="auth-referral-code"[\s\S]*?value=\{refCode\}[\s\S]*?onChangeText=\{setRefCode\}[\s\S]*?editable=\{!authInputsDisabled\}/,
    "prefilled referral codes should remain editable on signup",
  );
  const referralInput = authSource.match(
    /<Input\s+ref=\{referralInputRef\}[\s\S]*?style=\{s\.signupInput\}\s*\/>/,
  )?.[0];
  assert.ok(referralInput, "the referral code should remain a native text input after an error");
  assert.match(referralInput, /\baccessible\b/,
    "TalkBack should be able to focus the referral-code input");
  assert.match(referralInput, /accessibilityLabel="Referral Code, optional"/,
    "TalkBack should identify the optional referral code");
  assert.match(
    referralInput,
    /accessibilityHint="If Google sign-up rejects this code, edit it and return to Sign up with Google to retry\."/,
    "TalkBack should explain how to correct the code and return to the retry action",
  );
  assert.doesNotMatch(
    authSource,
    /refCode\.trim\(\)\s*\?\s*<Text[^>]*>Referral code/,
    "signup should not replace a referral input with static applied-code text",
  );
  assert.match(callbackSource, /getSSOCallbackMessage\(Platform\.OS,\s*authCompletion\?\.type\)/);
  assert.match(callbackSource, /Platform\.OS === 'web'[\s\S]*?WebBrowser\.maybeCompleteAuthSession\(\)/);
});

test("Google recovery errors use one native announcement path and keep recovery retries available", async () => {
  const buttonSource = await readFile(
    new URL("../src/components/GoogleSSOButton.tsx", import.meta.url),
    "utf8",
  );
  const requestRecovery = buttonSource.match(
    /const requestRecovery = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  const recoverWithOwnerCode = buttonSource.match(
    /const recoverWithOwnerCode = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  const googleErrorReporter = buttonSource.match(
    /function reportGoogleError\([\s\S]*?\n\}/,
  )?.[0];
  const requestRecoveryControl = buttonSource.match(
    /\{allowRecoveryRequest && \(recoveryAvailable \|\| error === RECOVERY_CONFLICT\) && \(\s*<Pressable[\s\S]*?testID="request-google-account-recovery"[\s\S]*?<\/Pressable>/,
  )?.[0];
  const ownerRecoveryControl = buttonSource.match(
    /\{allowRecoveryRequest && \(recoveryAvailable \|\| error === RECOVERY_CONFLICT \|\| recoverySubmitted\) && \(\s*<View[\s\S]*?testID="owner-recovery-code"[\s\S]*?testID="recover-with-owner-code"[\s\S]*?<\/View>/,
  )?.[0];

  assert.ok(requestRecovery, "recovery review handler should exist");
  assert.ok(recoverWithOwnerCode, "owner-code recovery handler should exist");
  assert.ok(googleErrorReporter, "Google errors should use the shared error reporter");
  assert.ok(requestRecoveryControl, "recovery review should remain available while recovery is active");
  assert.ok(ownerRecoveryControl, "owner-code input and recovery action should remain available");

  assert.match(
    googleErrorReporter,
    /onError\?\.\(message\);[\s\S]*?if \(Platform\.OS !== 'web'\) \{\s*AccessibilityInfo\.announceForAccessibility\(message\);/,
  );
  assert.equal(
    (googleErrorReporter.match(/AccessibilityInfo\.announceForAccessibility\(message\)/g) ?? []).length,
    1,
    "recovery errors should share exactly one direct native announcement call",
  );
  assert.match(buttonSource, /const showError = \(message: string\) => \{\s*setError\(message\);\s*reportGoogleError\(onError, message\);/);

  assert.match(
    requestRecovery,
    /if \(!activeSession\) \{\s*showError\('Your Google session has expired\. Choose Continue with Google and try again\.'\);\s*return;/,
    "missing-session recovery-review errors should be reported",
  );
  assert.match(
    requestRecovery,
    /catch \(e: any\) \{\s*setRecoveryAvailable\(true\);\s*showError\(apiError\(e\)\);/,
    "failed recovery-review requests should report an error and restore recovery availability",
  );
  assert.match(requestRecovery, /finally \{\s*setRecoveryBusy\(false\);\s*\}/);
  assert.match(requestRecoveryControl, /disabled=\{recoveryBusy\}/);

  assert.match(
    recoverWithOwnerCode,
    /if \(!activeSession\) \{\s*showError\('Your Google session has expired\. Choose Continue with Google and try again\.'\);\s*return;/,
    "missing-session owner-code errors should be reported",
  );
  assert.match(
    recoverWithOwnerCode,
    /await Api\.requestGoogleOwnerRecovery\(clerkJwt, ownerRecoveryCode\);[\s\S]*?setOwnerRecoveryCode\(''\);[\s\S]*?setRecoveryAvailable\(false\);/,
    "owner recovery state should only be cleared after the server accepts the owner code",
  );
  assert.match(
    recoverWithOwnerCode,
    /\} catch \(e: any\) \{\s*showError\(recoveryCompleted[\s\S]*?: apiError\(e\)\);/,
    "owner-code failures should report their error",
  );
  assert.match(recoverWithOwnerCode, /finally \{\s*setRecoveryBusy\(false\);/);
  assert.match(ownerRecoveryControl, /accessibilityLabel="Owner recovery code"/);
  assert.match(ownerRecoveryControl, /accessibilityLabel="Recover sole Full Admin account with owner code"/);
  assert.match(ownerRecoveryControl, /disabled=\{recoveryBusy \|\| !ownerRecoveryCode\.trim\(\)\}/);
});

test("the recovery accessibility harness is development-only and cannot call real recovery endpoints", async () => {
  const buttonSource = await readFile(
    new URL("../src/components/GoogleSSOButton.tsx", import.meta.url),
    "utf8",
  );
  const authSource = await readFile(
    new URL("../src/screens/Auth.tsx", import.meta.url),
    "utf8",
  );
  const profileSource = await readFile(
    new URL("../src/screens/Profile.tsx", import.meta.url),
    "utf8",
  );
  const testScreenSource = await readFile(
    new URL("../src/screens/GoogleRecoveryAccessibilityTest.tsx", import.meta.url),
    "utf8",
  );
  const testRouteSource = await readFile(
    new URL("../app/google-recovery-accessibility-test.tsx", import.meta.url),
    "utf8",
  );
  const requestRecovery = buttonSource.match(
    /const requestRecovery = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  const recoverWithOwnerCode = buttonSource.match(
    /const recoverWithOwnerCode = async \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];

  assert.ok(requestRecovery, "recovery review handler should exist");
  assert.ok(recoverWithOwnerCode, "owner-code recovery handler should exist");
  assert.match(
    testScreenSource,
    /if \(!__DEV__\) return <Redirect href="\/" \/>;/,
    "the recovery harness should redirect away outside development builds",
  );
  assert.match(
    testScreenSource,
    /Errors are generated locally; this screen does not send recovery requests or use the real owner code\./,
  );
  assert.match(testScreenSource, /devRecoveryTestScenario=\{scenario\}/);
  assert.match(testScreenSource, /accessibilityLiveRegion=\{Platform\.OS === 'web' \? 'assertive' : undefined\}/);
  assert.match(testRouteSource, /<GoogleRecoveryAccessibilityTest \/>/);
  assert.match(
    authSource,
    /\{__DEV__ && \([\s\S]*?<Link href="\/google-recovery-accessibility-test" asChild>/,
    "the test screen link should only appear during development",
  );
  assert.doesNotMatch(authSource, /allowRecoveryRequest/);
  assert.doesNotMatch(profileSource, /allowRecoveryRequest/);

  assert.match(
    requestRecovery,
    /if \(isRecoveryTestMode\) \{\s*throw new Error\('Test failure: recovery review was not submitted\.[\s\S]*?\n      \}\s*await Api\.requestGoogleRecovery/,
    "the test recovery-request failure must happen before the real endpoint",
  );
  assert.match(
    recoverWithOwnerCode,
    /if \(isRecoveryTestMode\) \{\s*throw new Error\('Test rejection: the owner code was not accepted\.[\s\S]*?\n      \}\s*await Api\.requestGoogleOwnerRecovery/,
    "the test owner-code failure must happen before the real endpoint",
  );
  assert.match(
    buttonSource,
    /const isRecoveryTestMode = __DEV__ && allowRecoveryRequest === true && devRecoveryTestScenario !== undefined;/,
    "simulated sessions and failures must be gated by development mode and the recovery test opt-in",
  );
});
