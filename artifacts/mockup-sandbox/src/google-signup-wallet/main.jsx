import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../../daily007/src/App";
import { currentUser, http } from "../../../daily007/src/lib/api";
import storage from "./mocks/async-storage";
import { getClerkMockSnapshot, resetClerkMock } from "./mocks/clerk-expo";

const ACCOUNT = {
  id: "mock-daily007-google-player",
  name: "Mock Google Player",
  email: "google-player@example.test",
  role: "player",
  coins: 10,
};
const DAILY007_TOKEN = "mock-daily007-session-token";
const PASSWORD_ACCOUNT = {
  id: "mock-password-player",
  name: "Mock Password Player",
  email: "password-player@example.test",
  phone: "5550101",
  gameUid: "FF-424242",
  role: "user",
  coins: 42,
  matches: 12,
  wins: 4,
  kills: 39,
  prizeCoins: 85,
  googleLinked: false,
};
const PASSWORD_TOKEN = "mock-password-account-token";
const PASSWORD_SIGNUP_ACCOUNT = {
  id: "mock-password-signup-player",
  name: "Mock Password Signup Player",
  email: "password-signup@example.test",
  phone: "5550102",
  gameUid: "FF-525252",
  role: "user",
  coins: 10,
};
const PASSWORD_SIGNUP_TOKEN = "mock-password-signup-session-token";
const scenario = new URLSearchParams(window.location.search).get("scenario");
const storageFailureScenario = scenario === "storage-write-failure";
const passwordSignupStorageFailureScenario = scenario === "password-signup-storage-failure";
const passwordSignupRestartScenario = scenario === "password-signup-restart";
const profileLinkStorageRestartScenario = scenario === "profile-link-storage-restart";
const restartBackendStorageKey = "daily007-test-password-signup-backend";
const restartScenarioMarkerKey = "daily007-test-password-signup-scenario";
const profileLinkRestartBackendStorageKey = "daily007-test-profile-link-backend";
const profileLinkRestartScenarioMarkerKey = "daily007-test-profile-link-scenario";
let passwordSignupRestartFirstLoad = false;
if (passwordSignupRestartScenario) {
  passwordSignupRestartFirstLoad =
    window.sessionStorage.getItem(restartScenarioMarkerKey) !== scenario;
  if (passwordSignupRestartFirstLoad) {
    window.sessionStorage.setItem(restartScenarioMarkerKey, scenario);
    window.localStorage.removeItem(restartBackendStorageKey);
  }
}
let profileLinkStorageRestartFirstLoad = false;
if (profileLinkStorageRestartScenario) {
  profileLinkStorageRestartFirstLoad =
    window.sessionStorage.getItem(profileLinkRestartScenarioMarkerKey) !== scenario;
  if (profileLinkStorageRestartFirstLoad) {
    window.sessionStorage.setItem(profileLinkRestartScenarioMarkerKey, scenario);
    window.localStorage.removeItem(profileLinkRestartBackendStorageKey);
  }
}
const savedRestartBackendState = passwordSignupRestartScenario
  ? JSON.parse(window.localStorage.getItem(restartBackendStorageKey) ?? "{}")
  : {};
const savedProfileLinkRestartBackendState = profileLinkStorageRestartScenario
  ? JSON.parse(window.localStorage.getItem(profileLinkRestartBackendStorageKey) ?? "{}")
  : {};
const heldGoogleExchangeScenario = scenario === "double-tap" || scenario === "login-conflict";
const profileLinkScenario = scenario?.startsWith("profile-link-") ?? false;
const calls = passwordSignupRestartScenario
  ? (savedRestartBackendState.calls ?? [])
  : profileLinkStorageRestartScenario
    ? (savedProfileLinkRestartBackendState.calls ?? [])
    : [];
const unexpectedRequests = passwordSignupRestartScenario
  ? (savedRestartBackendState.unexpectedRequests ?? [])
  : profileLinkStorageRestartScenario
    ? (savedProfileLinkRestartBackendState.unexpectedRequests ?? [])
    : [];
const pendingGoogleExchangeResolvers = [];
let googleExchangeAttempts = 0;
let inFlightGoogleExchanges = 0;
let maxConcurrentGoogleExchanges = 0;
let passwordAuthAttempts = savedRestartBackendState.passwordAuthAttempts ?? 0;
let passwordSignupAttempts = savedRestartBackendState.passwordSignupAttempts ?? 0;
let passwordSignupRegistered = savedRestartBackendState.passwordSignupRegistered ?? false;
let passwordSignupLoginCredentialMatched = savedRestartBackendState.passwordSignupLoginCredentialMatched ?? false;
let googleLinkedForPasswordAccount = scenario === "profile-link-already-linked"
  || (profileLinkStorageRestartScenario && Boolean(savedProfileLinkRestartBackendState.googleLinked));

function persistRestartBackendState() {
  if (profileLinkStorageRestartScenario) {
    window.localStorage.setItem(profileLinkRestartBackendStorageKey, JSON.stringify({
      calls,
      unexpectedRequests,
      googleLinked: googleLinkedForPasswordAccount,
    }));
    return;
  }
  if (!passwordSignupRestartScenario) return;
  window.localStorage.setItem(restartBackendStorageKey, JSON.stringify({
    calls,
    unexpectedRequests,
    passwordAuthAttempts,
    passwordSignupAttempts,
    passwordSignupRegistered,
    passwordSignupLoginCredentialMatched,
  }));
}

function requestBody(config) {
  if (typeof config.data !== "string") return config.data ?? {};
  try {
    return JSON.parse(config.data);
  } catch {
    return {};
  }
}

function rejectMockAuth(config, status, message, statusText) {
  const call = calls.at(-1);
  if (call) call.status = status;
  persistRestartBackendState();
  throw Object.assign(new Error(message), {
    config,
    response: {
      config,
      data: { error: message },
      headers: {},
      status,
      statusText,
    },
  });
}

function authorizationHeader(config) {
  const headers = config.headers;
  if (typeof headers?.get === "function") return headers.get("Authorization");
  return headers?.Authorization ?? headers?.authorization ?? null;
}

function daily007TokenHeader(config) {
  const headers = config.headers;
  if (typeof headers?.get === "function") return headers.get("X-Daily007-Token");
  return headers?.["X-Daily007-Token"] ?? headers?.["x-daily007-token"] ?? null;
}

function respond(config, payload) {
  persistRestartBackendState();
  return {
    config,
    data: { success: true, data: payload },
    headers: {},
    status: 200,
    statusText: "OK",
  };
}

function requestPath(config) {
  const raw = String(config.url ?? "");
  const pathname = raw.startsWith("http") ? new URL(raw).pathname : raw.split("?")[0];
  return pathname.replace(/^\/api(?=\/)/, "");
}

http.defaults.adapter = async (config) => {
  const method = String(config.method ?? "get").toUpperCase();
  const path = requestPath(config);
  const call = {
    method,
    path,
    authorization: authorizationHeader(config),
    daily007Token: daily007TokenHeader(config),
    ...(scenario === "lowercase-referral" && method === "POST" && path === "/auth/google"
      ? { body: requestBody(config) }
      : {}),
  };
  calls.push(call);
  persistRestartBackendState();

  if (passwordSignupRestartScenario && method === "POST" && path === "/auth/register") {
    passwordAuthAttempts += 1;
    passwordSignupAttempts += 1;
    if (passwordSignupRegistered) {
      return rejectMockAuth(config, 409, "This mock account has already been registered.", "Conflict");
    }
    passwordSignupRegistered = true;
    call.status = 200;
    persistRestartBackendState();
    return respond(config, { ...PASSWORD_SIGNUP_ACCOUNT, token: PASSWORD_SIGNUP_TOKEN });
  }
  if (passwordSignupRestartScenario && method === "POST" && path === "/auth/login") {
    passwordAuthAttempts += 1;
    const body = requestBody(config);
    passwordSignupLoginCredentialMatched =
      passwordSignupRegistered &&
      body.email === "password-signup@example.test" &&
      body.password === "testpass123";
    if (!passwordSignupLoginCredentialMatched) {
      return rejectMockAuth(config, 401, "Email or password is incorrect.", "Unauthorized");
    }
    call.status = 200;
    persistRestartBackendState();
    return respond(config, { ...PASSWORD_SIGNUP_ACCOUNT, token: PASSWORD_SIGNUP_TOKEN });
  }
  if (passwordSignupStorageFailureScenario && method === "POST" && path === "/auth/register") {
    passwordAuthAttempts += 1;
    passwordSignupAttempts += 1;
    call.status = 200;
    return respond(config, { ...PASSWORD_SIGNUP_ACCOUNT, token: PASSWORD_SIGNUP_TOKEN });
  }
  if (method === "POST" && (path === "/auth/login" || path === "/auth/register")) {
    passwordAuthAttempts += 1;
    call.status = 200;
    return respond(config, path === "/auth/register"
      ? { ...PASSWORD_SIGNUP_ACCOUNT, token: PASSWORD_SIGNUP_TOKEN }
      : { ...PASSWORD_ACCOUNT, token: PASSWORD_TOKEN });
  }
  if (method === "POST" && path === "/auth/google") {
    googleExchangeAttempts += 1;
    if (heldGoogleExchangeScenario) {
      inFlightGoogleExchanges += 1;
      maxConcurrentGoogleExchanges = Math.max(maxConcurrentGoogleExchanges, inFlightGoogleExchanges);
      return new Promise((resolve) => {
        pendingGoogleExchangeResolvers.push(() => {
          inFlightGoogleExchanges -= 1;
          call.status = 200;
          resolve(respond(config, { ...ACCOUNT, token: DAILY007_TOKEN }));
        });
      });
    }
    if (scenario === "profile-link-error") {
      call.status = 503;
      throw Object.assign(new Error("Google linking is temporarily unavailable."), {
        config,
        response: {
          config,
          data: { error: "Google linking is temporarily unavailable. Please try again." },
          headers: {},
          status: 503,
          statusText: "Service Unavailable",
        },
      });
    }
    if (scenario === "profile-link-network-retry" && googleExchangeAttempts === 1) {
      call.failure = {
        type: "network",
        message: "Network Error",
        code: "ERR_NETWORK",
      };
      throw Object.assign(new Error("Network Error"), {
        config,
        code: "ERR_NETWORK",
        request: { url: config.url, method },
      });
    }
    if (!storageFailureScenario && !profileLinkScenario &&
        scenario !== "lowercase-referral" && googleExchangeAttempts === 1) {
      call.failure = {
        type: "network",
        message: "Network Error",
        code: "ERR_NETWORK",
      };
      throw Object.assign(new Error("Network Error"), {
        config,
        code: "ERR_NETWORK",
        request: { url: config.url, method },
      });
    }
    call.status = 200;
    if (profileLinkScenario) googleLinkedForPasswordAccount = true;
    return respond(config, profileLinkScenario
      ? { ...PASSWORD_ACCOUNT, googleLinked: true, token: PASSWORD_TOKEN }
      : { ...ACCOUNT, token: DAILY007_TOKEN });
  }
  if (method === "GET" && path === "/auth/me") {
    call.status = 200;
    const account = passwordSignupStorageFailureScenario || passwordSignupRestartScenario
      ? PASSWORD_SIGNUP_ACCOUNT
      : profileLinkScenario
        ? { ...PASSWORD_ACCOUNT, googleLinked: googleLinkedForPasswordAccount }
        : ACCOUNT;
    return respond(config, account);
  }
  if (method === "GET" && path === "/me/stats") {
    return respond(config, { stats: { matches: 0, wins: 0, kills: 0, prizeCoins: 0 } });
  }
  if (method === "GET" && path === "/wallet/transactions") {
    call.status = 200;
    const transactions = scenario === "lowercase-referral"
      ? [{
        id: "mock-referral-signup-bonus",
        amount: 10,
        balanceAfter: 10,
        reason: "Referral Signup Bonus",
        description: "Referral Signup Bonus",
        createdAt: "2026-10-17T07:00:00.000Z",
      }]
      : profileLinkScenario
      ? [{
        id: "mock-password-account-wallet-row",
        amount: 5,
        balanceAfter: PASSWORD_ACCOUNT.coins,
        reason: "Tournament prize",
        description: "Existing password-account wallet history",
        createdAt: "2026-10-05T10:00:00.000Z",
      }]
      : [{
        id: "mock-welcome-signup-bonus",
        amount: 10,
        balanceAfter: 10,
        reason: "Welcome Signup Bonus",
        description: "Welcome Signup Bonus",
        createdAt: "2026-10-05T10:00:00.000Z",
      }];
    return respond(config, { items: transactions, nextCursor: null });
  }
  if (method === "GET" && path === "/my/payments") {
    return respond(config, { items: [], nextCursor: null });
  }
  if (method === "GET" && path === "/my/withdrawals") return respond(config, []);
  if (method === "GET" && path === "/settings") {
    return respond(config, {
      settings: {
        rechargeEnabled: false,
        withdrawalEnabled: false,
        minPurchase: 1,
        maxPurchase: 5000,
      },
    });
  }
  if (method === "GET" && path === "/daily007/v2/admin/bootstrap-status") {
    return respond(config, { available: false });
  }

  const message = `Unexpected isolated API request: ${method} ${path}`;
  unexpectedRequests.push(message);
  persistRestartBackendState();
  throw Object.assign(new Error(message), {
    config,
    response: { status: 500, data: { error: message } },
  });
};

if (profileLinkStorageRestartScenario) {
  storage.enablePersistentMode();
  storage.clear({ preservePersistent: !profileLinkStorageRestartFirstLoad });
} else {
  storage.clear();
}
if (storageFailureScenario) storage.failNextSessionWrite();
if (passwordSignupStorageFailureScenario) storage.failSessionWrites(2);
if (passwordSignupRestartScenario && passwordSignupRestartFirstLoad) storage.failNextSessionWrite();
if (profileLinkScenario && (!profileLinkStorageRestartScenario || profileLinkStorageRestartFirstLoad)) {
  storage.seedSession({ ...PASSWORD_ACCOUNT, token: PASSWORD_TOKEN });
}
resetClerkMock({
  startResultType: scenario === "profile-link-cancel" ? "dismiss" : null,
});
window.__daily007GoogleSignupWalletTest = {
  async snapshot() {
    const rawSession = await storage.getItem("daily007_v2_session");
    return {
      calls: [...calls],
      clerk: getClerkMockSnapshot(),
      currentSession: currentUser(),
      activeAuthorization: http.defaults.headers.common?.Authorization ?? null,
      storedSession: rawSession ? JSON.parse(rawSession) : null,
      sessionStorage: storage.snapshot(),
      storageWriteMetrics: storage.writeMetrics(),
      googleExchangeAttempts,
      inFlightGoogleExchanges,
      maxConcurrentGoogleExchanges,
      passwordAuthAttempts,
      passwordSignupAttempts,
      passwordSignupRegistered,
      passwordSignupLoginCredentialMatched,
      heldSessionWrite: storage.hasHeldSessionWrite(),
      unexpectedRequests: [...unexpectedRequests],
    };
  },
  resolveNextGoogleExchange() {
    const resolve = pendingGoogleExchangeResolvers.shift();
    if (!resolve) return false;
    resolve();
    return true;
  },
  rejectNextSessionWrite() {
    storage.failNextSessionWrite();
    return true;
  },
  holdNextSessionWrite() {
    storage.holdNextSessionWrite();
    return true;
  },
  releaseHeldSessionWrite() {
    return storage.releaseHeldSessionWrite();
  },
  rejectHeldSessionWrite() {
    return storage.rejectHeldSessionWrite();
  },
};

createRoot(document.getElementById("root")).render(<App />);
