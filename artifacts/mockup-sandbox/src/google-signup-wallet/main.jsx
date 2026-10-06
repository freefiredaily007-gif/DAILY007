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
};
const PASSWORD_TOKEN = "mock-password-account-token";
const scenario = new URLSearchParams(window.location.search).get("scenario");
const storageFailureScenario = scenario === "storage-write-failure";
const profileLinkScenario = scenario?.startsWith("profile-link-") ?? false;
const calls = [];
const unexpectedRequests = [];
let googleExchangeAttempts = 0;

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
  };
  calls.push(call);

  if (method === "POST" && path === "/auth/google") {
    googleExchangeAttempts += 1;
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
    if (!storageFailureScenario && !profileLinkScenario && googleExchangeAttempts === 1) {
      call.status = 503;
      throw Object.assign(new Error("Daily007 signup exchange is temporarily unavailable."), {
        config,
        response: {
          config,
          data: { error: "Daily007 signup exchange is temporarily unavailable. Please try again." },
          headers: {},
          status: 503,
          statusText: "Service Unavailable",
        },
      });
    }
    call.status = 200;
    return respond(config, profileLinkScenario
      ? { ...PASSWORD_ACCOUNT, token: PASSWORD_TOKEN }
      : { ...ACCOUNT, token: DAILY007_TOKEN });
  }
  if (method === "GET" && path === "/auth/me") {
    return respond(config, profileLinkScenario ? PASSWORD_ACCOUNT : ACCOUNT);
  }
  if (method === "GET" && path === "/me/stats") {
    return respond(config, { stats: { matches: 0, wins: 0, kills: 0, prizeCoins: 0 } });
  }
  if (method === "GET" && path === "/wallet/transactions") {
    return respond(config, profileLinkScenario
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
      }]);
  }
  if (method === "GET" && path === "/my/payments") return respond(config, []);
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
  throw Object.assign(new Error(message), {
    config,
    response: { status: 500, data: { error: message } },
  });
};

storage.clear();
if (storageFailureScenario) storage.failNextSessionWrite();
if (profileLinkScenario) storage.seedSession({ ...PASSWORD_ACCOUNT, token: PASSWORD_TOKEN });
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
      unexpectedRequests: [...unexpectedRequests],
    };
  },
};

createRoot(document.getElementById("root")).render(<App />);
