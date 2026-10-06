import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../../daily007/src/App";
import { http } from "../../../daily007/src/lib/api";
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
const scenario = new URLSearchParams(window.location.search).get("scenario");
const storageFailureScenario = scenario === "storage-write-failure";
const calls = [];
const unexpectedRequests = [];
let googleExchangeAttempts = 0;

function authorizationHeader(config) {
  const headers = config.headers;
  if (typeof headers?.get === "function") return headers.get("Authorization");
  return headers?.Authorization ?? headers?.authorization ?? null;
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
  const call = { method, path, authorization: authorizationHeader(config) };
  calls.push(call);

  if (method === "POST" && path === "/auth/google") {
    googleExchangeAttempts += 1;
    if (!storageFailureScenario && googleExchangeAttempts === 1) {
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
    return respond(config, { ...ACCOUNT, token: DAILY007_TOKEN });
  }
  if (method === "GET" && path === "/auth/me") {
    return respond(config, ACCOUNT);
  }
  if (method === "GET" && path === "/me/stats") {
    return respond(config, { stats: { matches: 0, wins: 0, kills: 0, prizeCoins: 0 } });
  }
  if (method === "GET" && path === "/wallet/transactions") {
    return respond(config, [{
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

  const message = `Unexpected isolated API request: ${method} ${path}`;
  unexpectedRequests.push(message);
  throw Object.assign(new Error(message), {
    config,
    response: { status: 500, data: { error: message } },
  });
};

storage.clear();
if (storageFailureScenario) storage.failNextSessionWrite();
resetClerkMock();
window.__daily007GoogleSignupWalletTest = {
  async snapshot() {
    const rawSession = await storage.getItem("daily007_v2_session");
    return {
      calls: [...calls],
      clerk: getClerkMockSnapshot(),
      storedSession: rawSession ? JSON.parse(rawSession) : null,
      sessionStorage: storage.snapshot(),
      storageWriteMetrics: storage.writeMetrics(),
      googleExchangeAttempts,
      unexpectedRequests: [...unexpectedRequests],
    };
  },
};

createRoot(document.getElementById("root")).render(<App />);
