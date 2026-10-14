import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

const SESSION_KEY = "daily007_v2_session";
let storedSession = null;
let blockedSetItem = null;
let blockedGetItem = null;
const storage = {
  async getItem(key) {
    assert.equal(key, SESSION_KEY);
    const value = storedSession;
    const block = blockedGetItem;
    if (block) {
      blockedGetItem = null;
      block.entered.resolve();
      await block.release.promise;
    }
    return value;
  },
  async setItem(key, value) {
    assert.equal(key, SESSION_KEY);
    const block = blockedSetItem;
    if (block) {
      blockedSetItem = null;
      block.entered.resolve();
      await block.release.promise;
    }
    storedSession = value;
  },
  async removeItem(key) {
    assert.equal(key, SESSION_KEY);
    storedSession = null;
  },
};

mock.module("@react-native-async-storage/async-storage", {
  defaultExport: storage,
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

const {
  captureSessionIdentity,
  currentUser,
  getSession,
  http,
  setSession,
  setSessionForIdentity,
} = await import("../src/lib/api.ts");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function blockNextStorageWrite() {
  const block = { entered: deferred(), release: deferred() };
  blockedSetItem = block;
  return block;
}

function blockNextStorageRead() {
  const block = { entered: deferred(), release: deferred() };
  blockedGetItem = block;
  return block;
}

test("a refresh write already in progress cannot restore the session after logout", async () => {
  const account = { id: "logout-race-account", token: "logout-race-token", role: "user" };
  await setSession(account);
  const identity = captureSessionIdentity();
  assert.ok(identity);

  const blockedWrite = blockNextStorageWrite();
  const refreshWrite = setSessionForIdentity(
    { ...account, role: "admin" },
    identity,
  );
  await blockedWrite.entered.promise;

  const logoutWrite = setSession(null);
  assert.equal(currentUser(), null);
  blockedWrite.release.resolve();

  assert.equal(await refreshWrite, false);
  await logoutWrite;
  assert.equal(currentUser(), null);
  assert.equal(storedSession, null);
});

test("a queued sign-in remains the final persisted session after an older refresh write", async () => {
  const oldAccount = { id: "old-account", token: "old-token", role: "user" };
  const newAccount = { id: "new-account", token: "new-token", role: "admin" };
  await setSession(oldAccount);
  const identity = captureSessionIdentity();
  assert.ok(identity);

  const blockedWrite = blockNextStorageWrite();
  const refreshWrite = setSessionForIdentity(
    { ...oldAccount, role: "tournament_admin" },
    identity,
  );
  await blockedWrite.entered.promise;

  const newSignIn = setSession(newAccount);
  blockedWrite.release.resolve();

  assert.equal(await refreshWrite, false);
  await newSignIn;
  assert.equal(currentUser(), newAccount);
  assert.deepEqual(JSON.parse(storedSession), newAccount);
});

test("a late 401 from an older token cannot clear a newer active session", async () => {
  const activeAccount = { id: "new-account", token: "new-token", role: "admin" };
  await setSession(activeAccount);

  const rejectedInterceptor = http.interceptors.response.handlers
    .find((handler) => typeof handler.rejected === "function")
    ?.rejected;
  assert.equal(typeof rejectedInterceptor, "function");

  const oldRequestError = {
    config: {
      url: "/me/stats",
      headers: { Authorization: "Bearer old-token" },
    },
    response: { status: 401, data: { error: "Unauthorized" } },
  };
  await assert.rejects(
    rejectedInterceptor(oldRequestError),
    (error) => error === oldRequestError,
  );

  assert.equal(currentUser(), activeAccount);
  assert.deepEqual(JSON.parse(storedSession), activeAccount);
});

test("a saved-session read finishing after logout cannot restore the old session", async () => {
  const savedAccount = { id: "restore-logout-account", token: "restore-logout-token", role: "user" };
  await setSession(null);
  storedSession = JSON.stringify(savedAccount);

  const blockedRead = blockNextStorageRead();
  const restore = getSession();
  await blockedRead.entered.promise;

  const logout = setSession(null);
  assert.equal(currentUser(), null);
  await logout;
  assert.equal(storedSession, null);

  blockedRead.release.resolve();
  assert.equal(await restore, null);
  assert.equal(currentUser(), null);
  assert.equal(storedSession, null);
});

test("a saved-session read finishing after a new sign-in keeps the newer session", async () => {
  const savedAccount = { id: "restore-old-account", token: "restore-old-token", role: "user" };
  const newAccount = { id: "restore-new-account", token: "restore-new-token", role: "admin" };
  await setSession(null);
  storedSession = JSON.stringify(savedAccount);

  const blockedRead = blockNextStorageRead();
  const restore = getSession();
  await blockedRead.entered.promise;

  await setSession(newAccount);
  assert.equal(currentUser(), newAccount);
  assert.deepEqual(JSON.parse(storedSession), newAccount);

  blockedRead.release.resolve();
  assert.equal(await restore, newAccount);
  assert.equal(currentUser(), newAccount);
  assert.deepEqual(JSON.parse(storedSession), newAccount);
});
