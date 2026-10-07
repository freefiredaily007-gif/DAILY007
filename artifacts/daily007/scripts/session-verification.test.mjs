import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { mock } from "node:test";
import ts from "typescript";
import {
  restoreDaily007Session,
  subscribeToSessionVerificationRecovery,
} from "../src/lib/session-verification.ts";

const SESSION_KEY = "daily007_v2_session";
const savedSession = {
  id: "test-player",
  name: "Test Player",
  email: "player@example.test",
  token: "saved-test-token",
};

let storedSession = null;
const mockedStorage = {
  async getItem(key) {
    assert.equal(key, SESSION_KEY);
    return storedSession;
  },
  async setItem(key, value) {
    assert.equal(key, SESSION_KEY);
    storedSession = value;
  },
  async removeItem(key) {
    assert.equal(key, SESSION_KEY);
    storedSession = null;
  },
};

mock.module("@react-native-async-storage/async-storage", {
  defaultExport: mockedStorage,
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
const profileSource = await readFile(
  new URL("../src/screens/Profile.tsx", import.meta.url),
  "utf8",
);
const profileSourceFile = ts.createSourceFile(
  "Profile.tsx",
  profileSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function mockStorage(initialSession = savedSession) {
  let value = initialSession ? JSON.stringify(initialSession) : null;
  let removeCalls = 0;
  return {
    async getItem(key) {
      assert.equal(key, SESSION_KEY);
      return value;
    },
    async setItem(key, nextValue) {
      assert.equal(key, SESSION_KEY);
      value = nextValue;
    },
    async removeItem(key) {
      assert.equal(key, SESSION_KEY);
      removeCalls += 1;
      value = null;
    },
    readSession() {
      return value ? JSON.parse(value) : null;
    },
    get removeCalls() {
      return removeCalls;
    },
  };
}

function responseError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

async function restoreFromMockStorage(storage, verifyWithApi) {
  return restoreDaily007Session(
    async () => {
      const raw = await storage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    verifyWithApi,
    async (session) => {
      if (session) await storage.setItem(SESSION_KEY, JSON.stringify(session));
      else await storage.removeItem(SESSION_KEY);
    },
  );
}

function prepareApiSession() {
  setSession(null);
  storedSession = JSON.stringify(savedSession);
}

function mockApiRequests(t, { statsFailure, statsResponse } = {}) {
  const requests = [];
  t.mock.method(http, "get", async (path) => {
    requests.push(path);
    if (path === "/auth/me") {
      return {
        data: {
          id: "verified-player",
          name: "Verified Player",
          email: "verified@example.test",
          phone: "5550107",
          gameUid: "FF-VERIFIED",
          role: "user",
          status: "active",
          coins: 17,
          walletCoins: 17,
        },
      };
    }
    if (path === "/me/stats") {
      if (statsFailure) throw statsFailure;
      return { data: statsResponse };
    }
    assert.fail(`Unexpected API request: ${path}`);
  });
  return requests;
}

function createProfileScreen(user) {
  let profileDeclaration = null;

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "Profile") {
      profileDeclaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(profileSourceFile);
  assert.ok(profileDeclaration, "Profile should export its screen component.");
  const componentSource = profileDeclaration
    .getText(profileSourceFile)
    .replace(/^export\s+default\s+/, "");
  const javascript = ts.transpileModule(componentSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const s = new Proxy({}, {
    get: (_target, key) => ({ profileStyle: String(key) }),
  });
  const View = ({ children, style }) => {
    const styleList = Array.isArray(style) ? style : [style];
    const isStatCard = styleList.some((entry) => entry?.profileStyle === "stat");
    return React.createElement(
      "div",
      isStatCard ? { "data-testid": "profile-stat-card" } : undefined,
      children,
    );
  };
  const Text = ({ children, style, accessibilityLabel }) => {
    const testId = style?.profileStyle === "statV"
      ? "profile-stat-value"
      : style?.profileStyle === "statL"
        ? "profile-stat-label"
        : undefined;
    const props = {
      ...(testId ? { "data-testid": testId } : {}),
      ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
    };
    return React.createElement("span", props, children);
  };
  const Card = ({ children, testID }) => React.createElement(
    "section",
    testID ? { "data-testid": testID } : undefined,
    children,
  );
  const SectionTitle = ({ children }) => React.createElement("h2", null, children);
  const Button = ({ title, children, testID }) => React.createElement(
    "button",
    testID ? { "data-testid": testID } : undefined,
    children ?? title,
  );
  const KeyValue = ({ k, v }) => React.createElement(
    "div",
    null,
    React.createElement("span", null, k),
    React.createElement("span", null, v),
  );
  const scope = {
    React,
    ScrollView: ({ children }) => React.createElement("main", null, children),
    View,
    Modal: ({ visible, children }) => visible
      ? React.createElement("div", null, children)
      : null,
    Text,
    Input: () => null,
    SectionTitle,
    Card,
    Btn: Button,
    KV: KeyValue,
    GoogleSSOButton: () => null,
    useWindowDimensions: () => ({ width: 402, fontScale: 1 }),
    Platform: { OS: "android" },
    Application: { nativeApplicationVersion: "1.0.0", nativeBuildVersion: "7" },
    Constants: {
      expoConfig: { version: "1.0.0", android: { versionCode: 7 } },
    },
    useApp: () => ({ user, refresh: async () => user, logout() {} }),
    useNavigation: () => ({ navigate() {} }),
    useDaily007ChangePassword: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
    Api: { adminBootstrapStatus: async () => ({ available: false }) },
    apiError: () => "Request failed.",
    PROFILE_PASSWORD_MAX_LENGTH: 200,
    submitProfilePasswordChange: async () => null,
    C: new Proxy({}, { get: (_target, key) => String(key) }),
    s,
  };
  const Profile = new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn Profile;`,
  )(...Object.values(scope));
  return React.createElement(Profile);
}

test("401 and 403 verification responses clear the saved session", async () => {
  for (const status of [401, 403]) {
    const storage = mockStorage();
    const result = await restoreFromMockStorage(storage, async () => {
      throw responseError(status);
    });

    assert.deepEqual(result, { status: "rejected" });
    assert.equal(storage.readSession(), null);
    assert.equal(storage.removeCalls, 1);
  }
});

test("a server error preserves the saved token and returns a retry state", async () => {
  const storage = mockStorage();
  const result = await restoreFromMockStorage(storage, async () => {
    throw responseError(503);
  });

  assert.deepEqual(result, { status: "retry", session: savedSession });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("a network timeout preserves the saved token and returns a retry state", async () => {
  const storage = mockStorage();
  const timeout = Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
  const result = await restoreFromMockStorage(storage, async () => {
    throw timeout;
  });

  assert.deepEqual(result, { status: "retry", session: savedSession });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("temporary profile-statistics failures preserve the verified account", async (t) => {
  const failures = [
    {
      name: "a server error",
      error: Object.assign(new Error("HTTP 503"), {
        response: { status: 503, data: { error: "Statistics are unavailable." } },
      }),
      statsError: "Statistics are unavailable.",
    },
    {
      name: "a network failure",
      error: new Error("Network disconnected"),
      statsError: "Network disconnected",
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, { statsFailure: failure.error });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, undefined);
      assert.equal(user.wins, undefined);
      assert.equal(user.kills, undefined);
      assert.equal(user.prizeCoins, undefined);
      assert.equal(user.statsError, failure.statsError);
    });
  }
});

test("successful profile statistics map every counter and leave statsError clear", async (t) => {
  const responses = [
    {
      name: "camel-case prizeCoins",
      stats: { matches: 27, wins: 11, kills: 94, prizeCoins: 640 },
      expectedPrizeCoins: 640,
    },
    {
      name: "supported snake-case prize_coins alias",
      stats: { matches: 18, wins: 6, kills: 52, prize_coins: 375 },
      expectedPrizeCoins: 375,
    },
    {
      name: "valid zero-valued totals",
      stats: { matches: 0, wins: 0, kills: 0, prizeCoins: 0 },
      expectedPrizeCoins: 0,
    },
  ];

  for (const response of responses) {
    await t.test(response.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, {
        statsResponse: response.stats,
      });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, response.stats.matches);
      assert.equal(user.wins, response.stats.wins);
      assert.equal(user.kills, response.stats.kills);
      assert.equal(user.prizeCoins, response.expectedPrizeCoins);
      assert.equal(user.statsError, undefined);
    });
  }
});

test("Profile renders successfully refreshed totals under their matching labels", async (t) => {
  prepareApiSession();
  const statsResponse = { matches: 27, wins: 11, kills: 94, prizeCoins: 640 };
  const requests = mockApiRequests(t, { statsResponse });
  const refreshedUser = await Api.me();

  assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
  assert.equal(refreshedUser.matches, 27);
  assert.equal(refreshedUser.wins, 11);
  assert.equal(refreshedUser.kills, 94);
  assert.equal(refreshedUser.prizeCoins, 640);

  const markup = renderToStaticMarkup(createProfileScreen(refreshedUser));
  const statCards = [...markup.matchAll(
    /<div data-testid="profile-stat-card"><span data-testid="profile-stat-value">([^<]*)<\/span><span data-testid="profile-stat-label">([^<]*)<\/span><\/div>/g,
  )].map(([, value, label]) => [label, value]);

  assert.deepEqual(statCards, [
    ["MATCHES", "27"],
    ["WINS", "11"],
    ["KILLS", "94"],
    ["PRIZES", "🪙640"],
  ]);
  assert.doesNotMatch(markup, /Profile statistics are loading|Profile statistics unavailable:/);
});

test("successful but malformed profile statistics preserve the account and leave totals unavailable", async (t) => {
  const responses = [
    {
      name: "a missing prize coin total",
      stats: { matches: 9, wins: 2, kills: 31 },
    },
    {
      name: "a non-numeric kill total",
      stats: { matches: 9, wins: 2, kills: "many", prizeCoins: 120 },
    },
    {
      name: "a null kill total",
      stats: { matches: 9, wins: 2, kills: null, prizeCoins: 120 },
    },
    {
      name: "a blank kill total",
      stats: { matches: 9, wins: 2, kills: " ", prizeCoins: 120 },
    },
  ];

  for (const response of responses) {
    await t.test(response.name, async (subtest) => {
      prepareApiSession();
      const requests = mockApiRequests(subtest, {
        statsResponse: response.stats,
      });

      const user = await Api.me();

      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
      assert.equal(user.id, "verified-player");
      assert.equal(user.name, "Verified Player");
      assert.equal(user.email, "verified@example.test");
      assert.equal(user.coins, 17);
      assert.equal(user.token, savedSession.token);
      assert.equal(user.matches, undefined);
      assert.equal(user.wins, undefined);
      assert.equal(user.kills, undefined);
      assert.equal(user.prizeCoins, undefined);
      assert.equal(user.statsError, "Profile statistics response is incomplete.");
    });
  }
});

test("401 and 403 from profile statistics still reject the session", async (t) => {
  for (const status of [401, 403]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      prepareApiSession();
      const failure = responseError(status);
      const requests = mockApiRequests(subtest, { statsFailure: failure });

      await assert.rejects(Api.me(), (error) => error === failure);
      assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
    });
  }
});

test("a later successful retry restores the still-saved session", async () => {
  const storage = mockStorage();
  const failedAttempt = await restoreFromMockStorage(storage, async () => {
    throw responseError(503);
  });
  assert.equal(failedAttempt.status, "retry");
  assert.equal(storage.readSession().token, savedSession.token);

  const retry = await restoreFromMockStorage(storage, async () => ({
    ...savedSession,
    name: "Player Back Online",
  }));
  assert.equal(retry.status, "verified");
  assert.equal(retry.session.name, "Player Back Online");
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.removeCalls, 0);
});

test("restoring connectivity while verification is paused retries without user input", async () => {
  let networkListener;
  let networkState = { isConnected: false, isInternetReachable: false };
  let retries = 0;
  const network = {
    addNetworkStateListener(listener) {
      networkListener = listener;
      return { remove() {} };
    },
    async getNetworkStateAsync() {
      return networkState;
    },
  };
  const appState = {
    addEventListener() {
      return { remove() {} };
    },
  };

  const unsubscribe = subscribeToSessionVerificationRecovery(
    true,
    () => { retries += 1; },
    network,
    appState,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 0);

  networkState = { isConnected: true, isInternetReachable: true };
  networkListener(networkState);
  assert.equal(retries, 1);
  unsubscribe();
});

test("returning to the foreground rechecks connectivity and retries automatically", async () => {
  let appStateListener;
  let networkState = { isConnected: false, isInternetReachable: false };
  let retries = 0;
  const network = {
    addNetworkStateListener() {
      return { remove() {} };
    },
    async getNetworkStateAsync() {
      return networkState;
    },
  };
  const appState = {
    addEventListener(_event, listener) {
      appStateListener = listener;
      return { remove() {} };
    },
  };

  const unsubscribe = subscribeToSessionVerificationRecovery(
    true,
    () => { retries += 1; },
    network,
    appState,
  );
  await new Promise((resolve) => setImmediate(resolve));
  networkState = { isConnected: true, isInternetReachable: true };
  appStateListener("background");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 0);

  appStateListener("active");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries, 1);
  unsubscribe();
});

test("a successful verification refreshes account data while retaining the saved token", async () => {
  const storage = mockStorage();
  const result = await restoreFromMockStorage(storage, async () => ({
    id: "test-player",
    name: "Updated Test Player",
    email: "player@example.test",
    token: undefined,
    coins: 12,
  }));

  assert.deepEqual(result, {
    status: "verified",
    session: {
      id: "test-player",
      name: "Updated Test Player",
      email: "player@example.test",
      token: savedSession.token,
      coins: 12,
    },
  });
  assert.equal(storage.readSession().token, savedSession.token);
  assert.equal(storage.readSession().name, "Updated Test Player");
});

test("App shows a retry button instead of the authentication screen for transient verification failures", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const pausedScreen = await readFile(
    new URL("../src/components/SessionVerificationPaused.tsx", import.meta.url),
    "utf8",
  );
  assert.match(appSource, /result\.status === 'retry'\) setVerificationSession\(result\.session\)/);
  assert.match(appSource, /if \(!user && verificationSession\) return/);
  assert.match(pausedScreen, /Your session is still saved/);
  assert.match(pausedScreen, /testID="session-verification-retry"/);
  assert.match(appSource, /restoreDaily007Session\(\s*async \(\) => savedSession/);
  assert.match(appSource, /subscribeToSessionVerificationRecovery\(/);
  assert.match(appSource, /void retrySessionVerification\(\)/);
  assert.match(appSource, /if \(verificationRequest\.current\) return verificationRequest\.current/);
});