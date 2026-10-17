import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

const SESSION_KEY = "daily007_v2_session";
let storedSession = null;
let blockedSetItem = null;
let blockedGetItem = null;
let nextGetItemError = null;
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
    if (nextGetItemError) {
      const error = nextGetItemError;
      nextGetItemError = null;
      throw error;
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
  Api,
  captureSessionRevision,
  captureSessionIdentity,
  currentUser,
  getSession,
  http,
  setSession,
  setSessionForAuthAttempt,
  setSessionForIdentity,
} = await import("../src/lib/api.ts");
const { restoreDaily007Session } = await import("../src/lib/session-verification.ts");

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

test("a temporary saved-session read failure stays inactive and recovers through API verification", async (t) => {
  const savedAccount = {
    id: "read-retry-account",
    name: "Read Retry Player",
    email: "read-retry@example.test",
    token: "read-retry-token",
    role: "user",
  };
  await setSession(null);
  assert.equal(await getSession(), null, "A confirmed missing storage value must remain an empty session.");
  storedSession = JSON.stringify(savedAccount);
  nextGetItemError = new Error("Temporary AsyncStorage read failure.");
  const requests = [];
  t.mock.method(http, "get", async (path) => {
    requests.push(path);
    if (path === "/auth/me") {
      return {
        data: {
          id: savedAccount.id,
          name: "Verified Read Retry Player",
          email: savedAccount.email,
          role: "user",
          status: "active",
          coins: 9,
        },
      };
    }
    if (path === "/me/stats") {
      return { data: { matches: 3, wins: 1, kills: 7, prizeCoins: 20 } };
    }
    assert.fail(`Unexpected API request: ${path}`);
  });
  t.after(async () => {
    nextGetItemError = null;
    await setSession(null);
  });

  await assert.rejects(getSession(), /Temporary AsyncStorage read failure/);
  assert.equal(currentUser(), null, "A failed read must not activate an unverified saved token.");
  assert.equal(
    http.defaults.headers.common.Authorization,
    undefined,
    "A failed read must not install an Authorization header.",
  );
  assert.deepEqual(requests, [], "No API verification can run until the saved session is readable.");

  const recovered = await restoreDaily007Session(getSession, Api.me, setSession);
  assert.equal(recovered.status, "verified");
  assert.equal(recovered.session.id, savedAccount.id);
  assert.equal(recovered.session.name, "Verified Read Retry Player");
  assert.equal(recovered.session.token, savedAccount.token);
  assert.equal(currentUser().token, savedAccount.token);
  assert.deepEqual(requests, ["/auth/me", "/me/stats"]);
});

test("an authentication attempt started before logout cannot restore its account", async () => {
  const authRevision = captureSessionRevision();
  const logout = setSession(null);
  const staleSignIn = await setSessionForAuthAttempt(
    { id: "stale-auth-account", token: "stale-auth-token", role: "user" },
    authRevision,
  );

  await logout;
  assert.equal(staleSignIn, false);
  assert.equal(currentUser(), null);
  assert.equal(storedSession, null);
});

test("logout supersedes an authentication write already waiting on device storage", async () => {
  await setSession(null);
  const authRevision = captureSessionRevision();
  const blockedWrite = blockNextStorageWrite();
  const signIn = setSessionForAuthAttempt(
    { id: "pending-auth-account", token: "pending-auth-token", role: "user" },
    authRevision,
  );
  await blockedWrite.entered.promise;

  const logout = setSession(null);
  blockedWrite.release.resolve();

  assert.equal(await signIn, false);
  await logout;
  assert.equal(currentUser(), null);
  assert.equal(storedSession, null);
});
