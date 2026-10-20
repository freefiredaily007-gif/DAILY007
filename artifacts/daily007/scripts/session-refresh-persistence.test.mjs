import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

const SESSION_KEY = "daily007_v2_session";
const SIGNED_OUT_SESSION_RECORD = JSON.stringify({ __daily007SignedOut: true });
let storedSession = null;
let sessionRemoveCalls = 0;
let blockedSetItem = null;
let blockedGetItem = null;
let blockedRemoveItem = null;
let nextGetItemError = null;
let nextRemoveItemError = null;
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
    sessionRemoveCalls += 1;
    const block = blockedRemoveItem;
    if (block) {
      blockedRemoveItem = null;
      block.entered.resolve();
      await block.release.promise;
    }
    if (nextRemoveItemError) {
      const error = nextRemoveItemError;
      nextRemoveItemError = null;
      throw error;
    }
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
  clearSessionForLogout,
  currentUser,
  getSession,
  http,
  setSession,
  setSessionExpiredHandler,
  setSessionForAuthAttempt,
  setSessionForIdentity,
} = await import("../src/lib/api.ts");
const { restoreDaily007Session } = await import("../src/lib/session-verification.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

function blockNextStorageRemoval() {
  const block = { entered: deferred(), release: deferred() };
  blockedRemoveItem = block;
  return block;
}

test("a saved-session record without a token is removed", async () => {
  await setSession(null);
  storedSession = JSON.stringify({ id: "missing-token-account", name: "Incomplete" });

  assert.equal(await getSession(), null);
  assert.equal(storedSession, null);
  assert.equal(currentUser(), null);
});

test("failed cleanup of malformed and tokenless sessions stays inactive and retries after storage recovers", async (t) => {
  const invalidRecords = [
    ["malformed", "{broken saved session"],
    ["tokenless", JSON.stringify({ id: "missing-token-account", name: "Incomplete" })],
  ];

  for (const [name, invalidRecord] of invalidRecords) {
    await t.test(name, async (subtest) => {
      await setSession(null);
      sessionRemoveCalls = 0;
      storedSession = invalidRecord;
      nextRemoveItemError = new Error("Temporary AsyncStorage remove failure.");
      let verificationCalls = 0;
      const verifyWithApi = async () => {
        verificationCalls += 1;
        return { id: "unexpected-account", token: "unexpected-token" };
      };
      subtest.after(async () => {
        nextRemoveItemError = null;
        await setSession(null);
      });

      await assert.rejects(
        restoreDaily007Session(getSession, verifyWithApi, setSession),
        /Temporary AsyncStorage remove failure/,
      );
      assert.equal(currentUser(), null, "failed invalid-session cleanup must not activate a session");
      assert.equal(
        http.defaults.headers.common.Authorization,
        undefined,
        "the invalid token must not become an Authorization header",
      );
      assert.equal(storedSession, invalidRecord, "failed storage cleanup must leave the record available for retry");
      assert.equal(sessionRemoveCalls, 1);
      assert.equal(verificationCalls, 0, "API verification must not run for an unreadable invalid session");

      const retry = await restoreDaily007Session(getSession, verifyWithApi, setSession);
      assert.deepEqual(retry, { status: "empty" });
      assert.equal(storedSession, null, "a later retry should remove the invalid record");
      assert.equal(currentUser(), null);
      assert.equal(http.defaults.headers.common.Authorization, undefined);
      assert.equal(sessionRemoveCalls, 2);
      assert.equal(verificationCalls, 0);
    });
  }
});

test("invalid saved-session cleanup cannot overwrite a newer sign-in", async () => {
  const newAccount = { id: "new-cleanup-account", token: "new-cleanup-token", role: "user" };
  await setSession(null);
  storedSession = "{not valid JSON";

  const blockedRemoval = blockNextStorageRemoval();
  const restore = getSession();
  await blockedRemoval.entered.promise;

  const signIn = setSession(newAccount);
  blockedRemoval.release.resolve();

  await Promise.all([restore, signIn]);
  assert.equal(currentUser(), newAccount);
  assert.deepEqual(JSON.parse(storedSession), newAccount);
});

test("a failed invalid-session cleanup cannot displace a concurrent newer sign-in", async (t) => {
  const invalidRecord = "{not valid JSON";
  const newAccount = { id: "new-after-cleanup-error", token: "new-after-cleanup-token", role: "user" };
  await setSession(null);
  storedSession = invalidRecord;
  nextRemoveItemError = new Error("Temporary AsyncStorage remove failure.");
  const blockedRemoval = blockNextStorageRemoval();
  const restore = getSession();
  let signIn;

  try {
    await blockedRemoval.entered.promise;
    assert.equal(currentUser(), null);
    assert.equal(http.defaults.headers.common.Authorization, undefined);

    signIn = setSession(newAccount);
    assert.equal(currentUser(), null, "the new session must wait for durable persistence");
    blockedRemoval.release.resolve();
    const [restoreResult, signInResult] = await Promise.all([restore, signIn]);

    assert.equal(restoreResult, null, "stale cleanup must not restore the invalid record");
    assert.equal(signInResult, undefined);
    assert.equal(currentUser(), newAccount);
    assert.equal(
      http.defaults.headers.common.Authorization,
      `Bearer ${newAccount.token}`,
      "only the newer persisted token may be installed for API requests",
    );
    assert.deepEqual(JSON.parse(storedSession), newAccount);
  } finally {
    blockedRemoval.release.resolve();
    nextRemoveItemError = null;
    await Promise.allSettled([restore, signIn].filter(Boolean));
    await setSession(null);
  }
});

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

test("a blocked-account 403 expires the matching saved session with a blocked reason", async () => {
  const blockedAccount = { id: "blocked-account", token: "blocked-account-token", role: "user" };
  await setSession(blockedAccount);

  const rejectedInterceptor = http.interceptors.response.handlers
    .find((handler) => typeof handler.rejected === "function")
    ?.rejected;
  assert.equal(typeof rejectedInterceptor, "function");
  let expiredReason;
  let clearSession = Promise.resolve();
  setSessionExpiredHandler((reason) => {
    expiredReason = reason;
    clearSession = Promise.resolve(setSession(null));
  });

  try {
    const error = {
      config: {
        url: "/auth/me",
        headers: { Authorization: `Bearer ${blockedAccount.token}` },
      },
      response: { status: 403, data: { error: "This account is blocked." } },
    };
    await assert.rejects(
      rejectedInterceptor(error),
      (caught) => caught === error,
    );
    await clearSession;

    assert.equal(expiredReason, "blocked");
    assert.equal(currentUser(), null);
    assert.equal(storedSession, null);
  } finally {
    setSessionExpiredHandler(null);
    await setSession(null);
  }
});

test("a delayed blocked-account 403 for an older request cannot affect a newer sign-in", async () => {
  const oldAccount = { id: "old-blocked-account", token: "old-blocked-token", role: "user" };
  const newAccount = { id: "new-active-account", token: "new-active-token", role: "admin" };
  await setSession(oldAccount);

  const rejectedInterceptor = http.interceptors.response.handlers
    .find((handler) => typeof handler.rejected === "function")
    ?.rejected;
  assert.equal(typeof rejectedInterceptor, "function");

  const requestStarted = deferred();
  const delayedResponse = deferred();
  const olderRequest = http.get("/auth/me", {
    adapter: (config) => {
      requestStarted.resolve(config);
      return delayedResponse.promise;
    },
  });
  const requestConfig = await requestStarted.promise;
  assert.equal(
    requestConfig.headers.get("Authorization"),
    `Bearer ${oldAccount.token}`,
    "the pending request must carry the older account's token",
  );

  const expiredReasons = [];
  setSessionExpiredHandler((reason) => expiredReasons.push(reason));

  try {
    await setSession(newAccount);
    assert.equal(currentUser(), newAccount);
    assert.deepEqual(JSON.parse(storedSession), newAccount);

    const blockedError = {
      config: requestConfig,
      response: {
        status: 403,
        data: { error: "This account is blocked." },
      },
    };
    delayedResponse.reject(blockedError);

    await assert.rejects(olderRequest, (error) => error === blockedError);
    assert.deepEqual(expiredReasons, [], "the newer account must not receive a blocked-account notice");
    assert.equal(currentUser(), newAccount, "the newer in-memory session must remain active");
    assert.deepEqual(JSON.parse(storedSession), newAccount, "the newer saved session must remain active");
  } finally {
    setSessionExpiredHandler(null);
    await setSession(null);
  }
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

test("explicit logout cannot restore the saved account after storage removal fails", async (t) => {
  const savedAccount = {
    id: "logout-removal-failure-account",
    name: "Signed Out Player",
    email: "signed-out@example.test",
    token: "logout-removal-failure-token",
    role: "user",
  };
  await setSession(null);
  await setSession(savedAccount);
  nextRemoveItemError = new Error("Temporary AsyncStorage remove failure.");

  await clearSessionForLogout();
  assert.equal(currentUser(), null, "logout must clear the in-memory account immediately");
  assert.equal(http.defaults.headers.common.Authorization, undefined);
  assert.equal(
    storedSession,
    SIGNED_OUT_SESSION_RECORD,
    "a signed-out marker must replace the old token if removal fails",
  );

  const restartedApi = await import("../src/lib/api.ts?fresh-explicit-logout-relaunch");
  const requests = [];
  t.mock.method(restartedApi.http, "get", async (url) => {
    requests.push(url);
    throw new Error(`Unexpected API request after logout: ${url}`);
  });
  t.after(async () => {
    nextRemoveItemError = null;
    await restartedApi.setSession(null);
    await setSession(null);
  });

  const restored = await restoreDaily007Session(
    restartedApi.getSession,
    restartedApi.Api.me,
    restartedApi.setSession,
  );
  assert.deepEqual(restored, { status: "empty" });
  assert.equal(restartedApi.currentUser(), null);
  assert.deepEqual(requests, [], "the signed-out account must not be verified or used for API requests");
  assert.equal(storedSession, null, "startup should retry and complete the pending storage cleanup");
});

test("cleanup after a failed explicit logout cannot overwrite a later sign-in", async () => {
  const oldAccount = { id: "logout-cleanup-old", token: "logout-cleanup-old-token", role: "user" };
  const newAccount = { id: "logout-cleanup-new", token: "logout-cleanup-new-token", role: "admin" };
  await setSession(null);
  await setSession(oldAccount);
  nextRemoveItemError = new Error("Temporary AsyncStorage remove failure.");
  await clearSessionForLogout();
  assert.equal(storedSession, SIGNED_OUT_SESSION_RECORD);

  const restartedApi = await import("../src/lib/api.ts?fresh-explicit-logout-cleanup-race");
  const blockedRemoval = blockNextStorageRemoval();
  const cleanup = restartedApi.getSession();
  let signIn;

  try {
    await blockedRemoval.entered.promise;
    signIn = restartedApi.setSession(newAccount);
    blockedRemoval.release.resolve();

    await Promise.all([cleanup, signIn]);
    assert.equal(restartedApi.currentUser(), newAccount);
    assert.equal(
      restartedApi.http.defaults.headers.common.Authorization,
      `Bearer ${newAccount.token}`,
      "only the later sign-in may install an authorization header",
    );
    assert.equal(
      http.defaults.headers.common.Authorization,
      undefined,
      "the original API module must not retain an authorization header",
    );
    assert.deepEqual(JSON.parse(storedSession), newAccount);
  } finally {
    blockedRemoval.release.resolve();
    await Promise.allSettled([cleanup, signIn].filter(Boolean));
    await restartedApi.setSession(null);
    await setSession(null);
  }
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

test("a malformed saved session is discarded so a later launch does not reread it", async (t) => {
  await setSession(null);
  sessionRemoveCalls = 0;
  storedSession = "{broken saved session";
  t.after(async () => {
    await setSession(null);
  });

  assert.equal(await getSession(), null);
  assert.equal(currentUser(), null);
  assert.equal(storedSession, null, "Malformed saved data must be removed after a successful read.");
  assert.equal(sessionRemoveCalls, 1);

  const restartedApi = await import("../src/lib/api.ts?fresh-malformed-session");
  assert.equal(await restartedApi.getSession(), null);
  assert.equal(storedSession, null);
  assert.equal(
    sessionRemoveCalls,
    1,
    "A fresh app instance should find no malformed saved value to parse or remove again.",
  );
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
