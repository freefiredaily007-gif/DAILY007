import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import { restoreDaily007Session } from "../src/lib/session-verification.ts";

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
    (session) => {
      if (session) void storage.setItem(SESSION_KEY, JSON.stringify(session));
      else void storage.removeItem(SESSION_KEY);
    },
  );
}

function prepareApiSession() {
  setSession(null);
  storedSession = JSON.stringify(savedSession);
}

function mockApiRequests(t, statsFailure) {
  const requests = [];
  t.mock.method(http, "get", async (path) => {
    requests.push(path);
    if (path === "/auth/me") {
      return {
        data: {
          success: true,
          data: {
            id: "verified-player",
            name: "Verified Player",
            email: "verified@example.test",
            coins: 17,
          },
        },
      };
    }
    if (path === "/me/stats") throw statsFailure;
    assert.fail(`Unexpected API request: ${path}`);
  });
  return requests;
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
      const requests = mockApiRequests(subtest, failure.error);

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

test("401 and 403 from profile statistics still reject the session", async (t) => {
  for (const status of [401, 403]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      prepareApiSession();
      const failure = responseError(status);
      const requests = mockApiRequests(subtest, failure);

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
  assert.match(appSource, /result\.status === 'retry'\) setVerificationSession\(result\.session\)/);
  assert.match(appSource, /if \(!user && verificationSession\) return/);
  assert.match(appSource, /Your session is still saved/);
  assert.match(appSource, /testID="session-verification-retry"/);
  assert.match(appSource, /restoreDaily007Session\(\s*async \(\) => savedSession/);
});