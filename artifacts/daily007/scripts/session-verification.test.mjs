import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { restoreDaily007Session } from "../src/lib/session-verification.ts";

const SESSION_KEY = "daily007_v2_session";
const savedSession = {
  id: "test-player",
  name: "Test Player",
  email: "player@example.test",
  token: "saved-test-token",
};

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