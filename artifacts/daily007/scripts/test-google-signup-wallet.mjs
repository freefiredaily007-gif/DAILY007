import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const daily007Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(daily007Root, "../..");
const previewUrl = (port) => `http://127.0.0.1:${port}/google-signup-wallet-preview.html`;
const browserErrors = [];
const pending = new Map();
let nextMessageId = 0;
let viteOutput = "";
let vite;
let chromium;
let socket;
let temporaryProfile;

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port.");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitFor(url, label, processToWatch) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (processToWatch?.exitCode !== null && processToWatch?.exitCode !== undefined) {
      throw new Error(`${label} exited early with code ${processToWatch.exitCode}.\n${viteOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${label} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? "timeout"}\n${viteOutput}`);
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Chromium DevTools.")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(String(data));
        if (message.method === "Runtime.exceptionThrown") {
          const details = message.params.exceptionDetails;
          browserErrors.push(JSON.stringify({
            text: details?.text,
            description: details?.exception?.description,
            stack: details?.stackTrace?.callFrames?.slice(0, 3)
              .map((frame) => `${frame.url}:${frame.lineNumber + 1}`),
          }));
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          browserErrors.push(
            message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ||
              "Browser console error.",
          );
        }
        if (!message.id) return;
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error.message));
        else item.resolve(message.result);
      });
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chromium DevTools WebSocket failed."));
    });
  });
}

function cdp(method, params = {}) {
  const id = ++nextMessageId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitForExpression(expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return;
    await delay(100);
  }
  const details = await evaluate(`(async () => ({
    url: location.href,
    readyState: document.readyState,
    text: document.body?.innerText?.slice(0, 1600) ?? "",
    root: document.querySelector("#root")?.innerHTML?.slice(0, 800) ?? "",
    html: document.documentElement?.outerHTML?.slice(0, 1600) ?? "",
    flow: await window.__daily007GoogleSignupWalletTest?.snapshot?.().catch((error) => String(error)) ?? null,
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(
    `${label} did not appear: ${JSON.stringify(details)}\nBrowser errors: ${browserErrors.join(" | ")}\n${viteOutput}`,
  );
}

async function clickSelector(selector, label) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not click ${label} (${selector}).`);
}

async function setInputValue(selector, value, label) {
  const updated = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(target, ${JSON.stringify(value)});
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.value === ${JSON.stringify(value)};
  })()`);
  assert.equal(updated, true, `Could not enter ${label} in ${selector}.`);
}

async function clickSignupTab() {
  const clicked = await evaluate(`(() => {
    const text = [...document.querySelectorAll("*")]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === "SIGN UP");
    const target = text?.closest('[role="button"], [tabindex="0"], button') ?? text?.parentElement;
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, "Could not select the signup form.");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

try {
  const appConfig = JSON.parse(await readFile(path.join(daily007Root, "app.json"), "utf8")).expo;
  const expectedAppVersion = appConfig.version;
  const expectedAndroidBuild = String(appConfig.android.versionCode);
  const vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-google-signup-wallet-"));
  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@workspace/mockup-sandbox",
      "exec",
      "vite",
      "--config",
      "vite.google-signup-wallet.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(vitePort),
      "--strictPort",
    ],
    {
      cwd: workspaceRoot,
      env: { ...process.env, PORT: String(vitePort) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
  vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
  await waitFor(previewUrl(vitePort), "Google signup and Wallet Vite preview", vite);

  chromium = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${temporaryProfile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, "Headless Chromium", chromium);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await targetResponse.json();
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  assert.ok(pageTarget, "Chromium did not expose a page target.");
  await connectCdp(pageTarget.webSocketDebuggerUrl);
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 402,
    height: 874,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp("Page.navigate", { url: previewUrl(vitePort) });

  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="continue-with-google"]'))`,
    "the actual Daily007 authentication screen",
  );
  await clickSignupTab();
  await waitForExpression(
    `document.body.innerText.includes("Sign up with Google")`,
    "the Google signup action",
  );
  await clickSelector('[data-testid="continue-with-google"]', "Google signup action");

  await waitForExpression(
    `document.body.innerText.includes("Could not reach Daily007. Check your connection and try again.")`,
    "connection guidance after the first Google signup attempt loses its network",
  );
  const failedAttempt = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const failureView = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const retryButton = document.querySelector('[data-testid="continue-with-google"]');
    const nameInput = document.querySelector('input[placeholder="Enter Name"]');
    return {
      signupFieldsVisible: bodyText.includes("PLAYER PROFILE")
        && Boolean(nameInput),
      networkGuidanceVisible: bodyText.includes("Could not reach Daily007. Check your connection and try again."),
      nameInputDisabled: nameInput?.disabled === true,
      retryButtonLabel: retryButton?.getAttribute("aria-label") ?? retryButton?.innerText.trim() ?? "",
      retryButtonDisabled: retryButton?.getAttribute("aria-disabled") === "true"
        || retryButton?.hasAttribute("disabled") === true,
      signedInTabCount: document.querySelectorAll('[data-testid^="mock-tab-"]').length,
      walletBonusVisible: bodyText.includes("Welcome Signup Bonus"),
    };
  })()`);

  assert.equal(failedAttempt.googleExchangeAttempts, 1, "The first Daily007 exchange should fail exactly once.");
  assert.deepEqual(failedAttempt.calls.at(-1)?.failure, {
    type: "network",
    message: "Network Error",
    code: "ERR_NETWORK",
  }, "The first Google exchange should fail without an HTTP response.");
  assert.equal(failedAttempt.calls.at(-1)?.status, undefined, "A network failure must not be recorded as an HTTP status.");
  assert.deepEqual(failedAttempt.sessionStorage, {}, "A failed exchange must leave Daily007 session storage empty.");
  assert.equal(failedAttempt.storedSession, null, "A failed exchange must not persist a Daily007 session.");
  assert.equal(failedAttempt.currentSession, null, "A failed exchange must not create an in-memory Daily007 session.");
  assert.equal(failedAttempt.activeAuthorization, null, "A failed exchange must not activate a Daily007 bearer token.");
  assert.equal(failedAttempt.unexpectedRequests.length, 0, failedAttempt.unexpectedRequests.join("; "));
  assert.equal(failureView.signupFieldsVisible, true, "The signup form should remain usable after the exchange failure.");
  assert.equal(failureView.networkGuidanceVisible, true, "The signup form should explain how to recover from the connection failure.");
  assert.equal(failureView.nameInputDisabled, false, "The signup form should remain editable after the connection failure.");
  assert.equal(failureView.retryButtonLabel, "Sign up with Google", "The Google action should return to its retry label.");
  assert.equal(failureView.retryButtonDisabled, false, "The Google action should be enabled for retry.");
  assert.equal(failureView.signedInTabCount, 0, "A failed exchange must not render signed-in player tabs.");
  assert.equal(failureView.walletBonusVisible, false, "A failed exchange must not show Wallet content.");

  await clickSelector('[data-testid="continue-with-google"]', "retry Google signup action");
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="mock-tab-wallet"]'))`,
    "the signed-in player tabs after a successful retry",
  );

  const walletTab = await evaluate(`(() => {
    const tab = document.querySelector('[data-testid="mock-tab-wallet"]');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  assert.equal(walletTab, true, "The signed-in player could not open the Wallet tab.");
  await waitForExpression(
    `Boolean(document.querySelector('[aria-label="Available coins: 10"]'))
      && document.body.innerText.includes("Welcome Signup Bonus")`,
    "the 10-coin Wallet balance and welcome bonus transaction",
  );

  await waitForExpression(
    `window.__daily007GoogleSignupWalletTest.snapshot()
      .then((state) => state.storedSession?.token === "mock-daily007-session-token")`,
    "the persisted Daily007 session",
  );
  const report = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const bodyState = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const balance = document.querySelector('[aria-label="Available coins: 10"]');
    return {
      balanceLabel: balance?.getAttribute("aria-label") ?? null,
      balanceText: balance?.textContent?.trim() ?? null,
      welcomeBonusRowCount: bodyText.split("Welcome Signup Bonus").length - 1,
      walletTabSelected: document.querySelector('[data-testid="mock-tab-wallet"]')
        ?.getAttribute("aria-current") === "page",
    };
  })()`);

  assert.equal(bodyState.balanceLabel, "Available coins: 10");
  assert.match(bodyState.balanceText ?? "", /10/);
  assert.equal(bodyState.welcomeBonusRowCount, 1, "Wallet should show exactly one welcome bonus row.");
  assert.equal(bodyState.walletTabSelected, true, "The Wallet tab should be the active signed-in screen.");
  assert.equal(report.storedSession?.id, "mock-daily007-google-player");
  assert.equal(report.storedSession?.token, "mock-daily007-session-token");
  assert.equal(report.storedSession?.coins, 10);
  assert.deepEqual(report.sessionStorage, {
    daily007_v2_session: JSON.stringify(report.storedSession),
  });
  assert.equal(report.googleExchangeAttempts, 2, "The second Google exchange should succeed.");
  assert.deepEqual(report.clerk.events, ["start-sso", "set-active", "get-token", "get-token"]);
  assert.equal(report.clerk.startOptions[0]?.strategy, "oauth_google");
  assert.equal(report.unexpectedRequests.length, 0, report.unexpectedRequests.join("; "));

  const googleExchange = report.calls.filter((call) => call.method === "POST" && call.path === "/auth/google");
  assert.equal(googleExchange.length, 2, "Google signup should retry the Daily007 auth exchange once.");
  assert.deepEqual(googleExchange[0].failure, {
    type: "network",
    message: "Network Error",
    code: "ERR_NETWORK",
  });
  assert.equal(googleExchange[0].status, undefined);
  assert.equal(googleExchange[1].status, 200);
  assert.equal(googleExchange[0].authorization, "Bearer mock-clerk-verified-token");
  assert.equal(googleExchange[1].authorization, "Bearer mock-clerk-verified-token");
  assert.ok(
    report.calls.some((call) =>
      call.method === "GET" &&
      call.path === "/wallet/transactions" &&
      call.authorization === "Bearer mock-daily007-session-token"),
    "Wallet history should be requested using the saved Daily007 session.",
  );
  assert.deepEqual(browserErrors, [], `Browser errors during signup-to-Wallet flow: ${browserErrors.join(" | ")}`);

  await cdp("Page.navigate", {
    url: `${previewUrl(vitePort)}?scenario=double-tap`,
  });
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="continue-with-google"]'))`,
    "the authentication screen for the double-tap scenario",
  );
  await clickSignupTab();
  await waitForExpression(
    `document.body.innerText.includes("Sign up with Google")`,
    "the Google signup action for the double-tap scenario",
  );
  await clickSelector('[data-testid="continue-with-google"]', "first Google signup press");
  await waitForExpression(
    `window.__daily007GoogleSignupWalletTest.snapshot().then((state) =>
      state.googleExchangeAttempts === 1 && state.inFlightGoogleExchanges === 1)`,
    "the first Google exchange held pending",
  );
  const pendingBeforeSecondPress = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assert.equal(pendingBeforeSecondPress.googleExchangeAttempts, 1);
  assert.equal(pendingBeforeSecondPress.inFlightGoogleExchanges, 1);

  await clickSelector('[data-testid="continue-with-google"]', "second Google signup press while the first exchange is pending");
  const pendingAfterSecondPress = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const pendingView = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="continue-with-google"]');
    return {
      buttonDisabled: button?.getAttribute("aria-disabled") === "true"
        || button?.hasAttribute("disabled") === true
        || button?.disabled === true,
      loadingLabelVisible: button?.innerText.includes("CONNECTING TO GOOGLE") === true,
      signedInTabCount: document.querySelectorAll('[data-testid^="mock-tab-"]').length,
    };
  })()`);
  assert.equal(pendingAfterSecondPress.googleExchangeAttempts, 1, "A second press must not start another Google exchange.");
  assert.equal(pendingAfterSecondPress.inFlightGoogleExchanges, 1, "Only one Google exchange may remain in flight.");
  assert.equal(pendingAfterSecondPress.maxConcurrentGoogleExchanges, 1, "Google exchanges must not overlap.");
  assert.equal(
    pendingAfterSecondPress.calls.filter((call) => call.method === "POST" && call.path === "/auth/google").length,
    1,
  );
  assert.equal(pendingAfterSecondPress.storedSession, null, "A pending exchange must not persist a Daily007 session.");
  assert.equal(pendingAfterSecondPress.currentSession, null, "A pending exchange must not activate a Daily007 session.");
  assert.equal(pendingAfterSecondPress.activeAuthorization, null, "A pending exchange must not activate a Daily007 token.");
  assert.deepEqual(pendingAfterSecondPress.sessionStorage, {});
  assert.equal(pendingAfterSecondPress.unexpectedRequests.length, 0, pendingAfterSecondPress.unexpectedRequests.join("; "));
  assert.equal(pendingView.buttonDisabled, true, "The Google action must stay disabled while the exchange is pending.");
  assert.equal(pendingView.loadingLabelVisible, true, "The Google action should show its connecting state while pending.");
  assert.equal(pendingView.signedInTabCount, 0, "Signed-in tabs must stay hidden until the exchange succeeds.");

  assert.equal(
    await evaluate("window.__daily007GoogleSignupWalletTest.resolveNextGoogleExchange()"),
    true,
    "The held Google exchange should be available for release.",
  );
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="mock-tab-wallet"]'))`,
    "signed-in tabs after the single pending exchange succeeds",
  );
  const doubleTapWalletOpened = await evaluate(`(() => {
    const tab = document.querySelector('[data-testid="mock-tab-wallet"]');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  assert.equal(doubleTapWalletOpened, true, "The single successful signup should expose Wallet.");
  await waitForExpression(
    `Boolean(document.querySelector('[aria-label="Available coins: 10"]'))
      && document.body.innerText.includes("Welcome Signup Bonus")`,
    "the Wallet view after the single Google signup succeeds",
  );
  await waitForExpression(
    `window.__daily007GoogleSignupWalletTest.snapshot().then((state) =>
      state.inFlightGoogleExchanges === 0
      && state.storedSession?.token === "mock-daily007-session-token")`,
    "the completed exchange and saved Daily007 session",
  );
  const doubleTapReport = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const doubleTapWalletView = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const walletTab = document.querySelector('[data-testid="mock-tab-wallet"]');
    return {
      walletTabCount: document.querySelectorAll('[data-testid="mock-tab-wallet"]').length,
      walletTabSelected: walletTab?.getAttribute("aria-current") === "page",
      welcomeBonusRowCount: bodyText.split("Welcome Signup Bonus").length - 1,
    };
  })()`);
  const doubleTapExchanges = doubleTapReport.calls.filter(
    (call) => call.method === "POST" && call.path === "/auth/google",
  );
  assert.equal(doubleTapExchanges.length, 1, "Two presses should produce exactly one Google exchange.");
  assert.equal(doubleTapExchanges[0].status, 200);
  assert.equal(doubleTapReport.googleExchangeAttempts, 1);
  assert.equal(doubleTapReport.inFlightGoogleExchanges, 0);
  assert.equal(doubleTapReport.maxConcurrentGoogleExchanges, 1);
  assert.deepEqual(doubleTapReport.clerk.events, ["start-sso", "set-active", "get-token"]);
  assert.equal(doubleTapReport.storedSession?.id, "mock-daily007-google-player");
  assert.equal(doubleTapReport.storedSession?.token, "mock-daily007-session-token");
  assert.equal(doubleTapReport.currentSession?.id, "mock-daily007-google-player");
  assert.deepEqual(doubleTapReport.sessionStorage, {
    daily007_v2_session: JSON.stringify(doubleTapReport.storedSession),
  });
  assert.equal(doubleTapWalletView.walletTabCount, 1);
  assert.equal(doubleTapWalletView.walletTabSelected, true);
  assert.equal(doubleTapWalletView.welcomeBonusRowCount, 1, "Wallet should show only one welcome bonus row.");
  assert.equal(doubleTapReport.unexpectedRequests.length, 0, doubleTapReport.unexpectedRequests.join("; "));
  assert.deepEqual(browserErrors, [], `Browser errors during the double-tap flow: ${browserErrors.join(" | ")}`);

  await cdp("Page.navigate", {
    url: `${previewUrl(vitePort)}?scenario=storage-write-failure`,
  });
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="continue-with-google"]'))`,
    "the authentication screen for the storage-failure scenario",
  );
  await clickSignupTab();
  await waitForExpression(
    `document.body.innerText.includes("Sign up with Google")`,
    "the Google signup action for the storage-failure scenario",
  );
  await clickSelector('[data-testid="continue-with-google"]', "Google signup with rejected device storage");
  await waitForExpression(
    `document.body.innerText.includes("Daily007 could not save your session on this device. Check available storage and try again.")`,
    "recoverable session-storage error after the Google exchange succeeds",
  );

  const storageFailure = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const storageFailureView = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const retryButton = document.querySelector('[data-testid="continue-with-google"]');
    return {
      signupFieldsVisible: bodyText.includes("PLAYER PROFILE")
        && Boolean(document.querySelector('input[placeholder="Enter Name"]')),
      retryButtonLabel: retryButton?.getAttribute("aria-label") ?? retryButton?.innerText.trim() ?? "",
      retryButtonDisabled: retryButton?.getAttribute("aria-disabled") === "true"
        || retryButton?.hasAttribute("disabled") === true,
      signedInTabCount: document.querySelectorAll('[data-testid^="mock-tab-"]').length,
      walletBonusVisible: bodyText.includes("Welcome Signup Bonus"),
    };
  })()`);

  assert.equal(storageFailure.googleExchangeAttempts, 1, "The first API exchange should succeed before storage rejects the session.");
  assert.equal(storageFailure.calls.at(-1)?.status, 200);
  assert.deepEqual(storageFailure.sessionStorage, {}, "A rejected storage write must leave the Daily007 session absent.");
  assert.equal(storageFailure.storedSession, null, "A rejected storage write must not activate an in-memory session.");
  assert.deepEqual(storageFailure.storageWriteMetrics, {
    sessionWriteAttempts: 1,
    rejectedSessionWrites: 1,
  });
  assert.equal(storageFailureView.signupFieldsVisible, true, "Signup should remain usable after a device-storage failure.");
  assert.equal(storageFailureView.retryButtonLabel, "Sign up with Google");
  assert.equal(storageFailureView.retryButtonDisabled, false);
  assert.equal(storageFailureView.signedInTabCount, 0, "A rejected write must not expose signed-in tabs or Wallet.");
  assert.equal(storageFailureView.walletBonusVisible, false);

  await clickSelector('[data-testid="continue-with-google"]', "retry Google signup after storage failure");
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="mock-tab-wallet"]'))`,
    "signed-in tabs after session storage recovers",
  );
  const recoveredWalletTab = await evaluate(`(() => {
    const tab = document.querySelector('[data-testid="mock-tab-wallet"]');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  assert.equal(recoveredWalletTab, true, "Wallet should become available after the session write succeeds.");
  await waitForExpression(
    `Boolean(document.querySelector('[aria-label="Available coins: 10"]'))
      && document.body.innerText.includes("Welcome Signup Bonus")`,
    "Wallet content after a successful session-storage retry",
  );

  const recoveredStorage = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assert.equal(recoveredStorage.storedSession?.id, "mock-daily007-google-player");
  assert.equal(recoveredStorage.storedSession?.token, "mock-daily007-session-token");
  assert.deepEqual(recoveredStorage.sessionStorage, {
    daily007_v2_session: JSON.stringify(recoveredStorage.storedSession),
  });
  assert.equal(recoveredStorage.storageWriteMetrics.rejectedSessionWrites, 1);
  assert.ok(
    recoveredStorage.storageWriteMetrics.sessionWriteAttempts > recoveredStorage.storageWriteMetrics.rejectedSessionWrites,
    "A later AsyncStorage write should succeed after the injected rejection.",
  );
  assert.equal(recoveredStorage.googleExchangeAttempts, 2);
  assert.deepEqual(
    recoveredStorage.calls
      .filter((call) => call.method === "POST" && call.path === "/auth/google")
      .map((call) => call.status),
    [200, 200],
  );
  assert.equal(recoveredStorage.unexpectedRequests.length, 0, recoveredStorage.unexpectedRequests.join("; "));
  assert.deepEqual(
    recoveredStorage.clerk.events,
    ["start-sso", "set-active", "get-token", "get-token"],
  );
  assert.deepEqual(browserErrors, [], `Browser errors during signup and storage-recovery flows: ${browserErrors.join(" | ")}`);

  await cdp("Page.navigate", {
    url: `${previewUrl(vitePort)}?scenario=password-signup-storage-failure`,
  });
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="auth-submit"]'))`,
    "the authentication form for password signup storage recovery",
  );
  await clickSignupTab();
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="auth-name"]'))
      && Boolean(document.querySelector('[data-testid="auth-email"]'))
      && Boolean(document.querySelector('[data-testid="auth-password"]'))`,
    "the email/password signup fields",
  );
  await setInputValue('[data-testid="auth-name"]', "Mock Password Signup Player", "signup name");
  await setInputValue('[data-testid="auth-email"]', "password-signup@example.test", "signup email");
  await setInputValue('[data-testid="auth-password"]', "testpass123", "signup password");
  await clickSelector('[data-testid="auth-submit"]', "create a password account with rejected session storage");
  await waitForExpression(
    `document.body.innerText.includes("Daily007 could not save your session on this device. Check available storage and try again.")`,
    "the recoverable session-storage error after password registration",
  );

  const passwordSignupFailure = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const passwordSignupFailureView = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const retryButton = document.querySelector('[data-testid="auth-submit"]');
    const nameInput = document.querySelector('[data-testid="auth-name"]');
    const emailInput = document.querySelector('[data-testid="auth-email"]');
    const passwordInput = document.querySelector('[data-testid="auth-password"]');
    return {
      signupFormVisible: bodyText.includes("PLAYER PROFILE")
        && Boolean(nameInput)
        && Boolean(emailInput)
        && Boolean(passwordInput),
      sessionNotSavedMessageVisible: bodyText.includes(
        "Daily007 could not save your session on this device. Check available storage and try again.",
      ),
      retryButtonLabel: retryButton?.getAttribute("aria-label") ?? retryButton?.innerText.trim() ?? "",
      retryButtonDisabled: retryButton?.getAttribute("aria-disabled") === "true"
        || retryButton?.hasAttribute("disabled") === true
        || retryButton?.disabled === true,
      signupFieldsReadOnly: [nameInput, emailInput, passwordInput]
        .every((input) => input?.disabled === true || input?.readOnly === true),
      formValues: {
        name: nameInput?.value ?? "",
        email: emailInput?.value ?? "",
        password: passwordInput?.value ?? "",
      },
      signedInTabCount: document.querySelectorAll('[data-testid^="mock-tab-"]').length,
      walletBonusVisible: bodyText.includes("Welcome Signup Bonus"),
    };
  })()`);
  assert.equal(passwordSignupFailure.passwordSignupAttempts, 1, "The password account should be created once before session persistence fails.");
  assert.equal(
    passwordSignupFailure.calls.filter((call) => call.method === "POST" && call.path === "/auth/register").length,
    1,
  );
  assert.equal(passwordSignupFailure.calls.at(-1)?.status, 200);
  assert.deepEqual(passwordSignupFailure.storageWriteMetrics, {
    sessionWriteAttempts: 1,
    rejectedSessionWrites: 1,
  });
  assert.deepEqual(passwordSignupFailure.sessionStorage, {}, "A failed write must not leave a saved Daily007 session.");
  assert.equal(passwordSignupFailure.storedSession, null);
  assert.equal(passwordSignupFailure.currentSession, null);
  assert.equal(passwordSignupFailure.activeAuthorization, null);
  assert.equal(
    passwordSignupFailure.calls.some((call) => call.authorization || call.daily007Token),
    false,
    "No Daily007 authorization token may be active before the session is saved.",
  );
  assert.equal(
    passwordSignupFailure.calls.some((call) =>
      ["/auth/me", "/me/stats", "/wallet/transactions", "/my/payments", "/my/withdrawals"].includes(call.path)),
    false,
    "No protected account or Wallet data may be requested before the session is saved.",
  );
  assert.equal(passwordSignupFailureView.signupFormVisible, true, "The password signup form must remain visible.");
  assert.equal(passwordSignupFailureView.sessionNotSavedMessageVisible, true);
  assert.equal(passwordSignupFailureView.retryButtonLabel, "Retry saving session");
  assert.equal(passwordSignupFailureView.retryButtonDisabled, false, "Session persistence must remain retryable.");
  assert.equal(passwordSignupFailureView.signupFieldsReadOnly, true, "The signup details must not change while session persistence is retried.");
  assert.deepEqual(passwordSignupFailureView.formValues, {
    name: "Mock Password Signup Player",
    email: "password-signup@example.test",
    password: "testpass123",
  });
  assert.equal(passwordSignupFailureView.signedInTabCount, 0, "A fresh account must not expose protected tabs before its session is saved.");
  assert.equal(passwordSignupFailureView.walletBonusVisible, false);
  assert.equal(passwordSignupFailure.unexpectedRequests.length, 0, passwordSignupFailure.unexpectedRequests.join("; "));

  await clickSelector('[data-testid="auth-submit"]', "retry saving the password signup session");
  await waitForExpression(
    `Boolean(document.querySelector('[data-testid="mock-tab-wallet"]'))`,
    "signed-in tabs after password signup session storage recovers",
  );
  const passwordSignupWalletOpened = await evaluate(`(() => {
    const tab = document.querySelector('[data-testid="mock-tab-wallet"]');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  assert.equal(passwordSignupWalletOpened, true, "Wallet should be accessible after password signup recovery.");
  await waitForExpression(
    `Boolean(document.querySelector('[aria-label="Available coins: 10"]'))
      && document.body.innerText.includes("Welcome Signup Bonus")`,
    "Wallet content after the password signup session is saved",
  );
  const passwordSignupRecovery = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const passwordSignupWalletView = await evaluate(`(() => {
    const bodyText = document.body.innerText;
    const walletTab = document.querySelector('[data-testid="mock-tab-wallet"]');
    return {
      walletTabCount: document.querySelectorAll('[data-testid="mock-tab-wallet"]').length,
      walletTabSelected: walletTab?.getAttribute("aria-current") === "page",
      welcomeBonusRowCount: bodyText.split("Welcome Signup Bonus").length - 1,
    };
  })()`);
  const passwordSignupCalls = passwordSignupRecovery.calls.filter(
    (call) => call.method === "POST" && call.path === "/auth/register",
  );
  assert.equal(passwordSignupRecovery.passwordSignupAttempts, 1, "Retrying storage must not submit registration again.");
  assert.equal(passwordSignupCalls.length, 1, "The server-side account should not be created twice.");
  assert.equal(passwordSignupRecovery.currentSession?.id, "mock-password-signup-player");
  assert.equal(passwordSignupRecovery.currentSession?.token, "mock-password-signup-session-token");
  assert.equal(passwordSignupRecovery.storedSession?.id, "mock-password-signup-player");
  assert.equal(passwordSignupRecovery.storedSession?.token, "mock-password-signup-session-token");
  assert.equal(passwordSignupRecovery.activeAuthorization, "Bearer mock-password-signup-session-token");
  assert.deepEqual(passwordSignupRecovery.sessionStorage, {
    daily007_v2_session: JSON.stringify(passwordSignupRecovery.storedSession),
  });
  assert.equal(passwordSignupRecovery.storageWriteMetrics.rejectedSessionWrites, 1);
  assert.ok(passwordSignupRecovery.storageWriteMetrics.sessionWriteAttempts >= 2);
  assert.equal(passwordSignupWalletView.walletTabCount, 1);
  assert.equal(passwordSignupWalletView.walletTabSelected, true);
  assert.equal(passwordSignupWalletView.welcomeBonusRowCount, 1);
  assert.equal(passwordSignupRecovery.unexpectedRequests.length, 0, passwordSignupRecovery.unexpectedRequests.join("; "));
  assert.deepEqual(browserErrors, [], `Browser errors during password signup recovery: ${browserErrors.join(" | ")}`);

  const assertPasswordSession = (state, label) => {
    assert.equal(state.currentSession?.id, "mock-password-player", `${label}: active account ID changed.`);
    assert.equal(state.currentSession?.coins, 42, `${label}: active wallet balance changed.`);
    assert.equal(state.currentSession?.token, "mock-password-account-token", `${label}: active Daily007 token changed.`);
    assert.equal(state.activeAuthorization, "Bearer mock-password-account-token", `${label}: protected API authorization changed.`);
    assert.equal(state.storedSession?.id, "mock-password-player", `${label}: stored account ID changed.`);
    assert.equal(state.storedSession?.coins, 42, `${label}: stored wallet balance changed.`);
    assert.equal(state.storedSession?.token, "mock-password-account-token", `${label}: stored Daily007 token changed.`);
    const serializedSession = state.sessionStorage?.daily007_v2_session;
    assert.ok(serializedSession, `${label}: the password-account session is not persisted.`);
    assert.equal(JSON.parse(serializedSession).id, "mock-password-player");
    assert.equal(JSON.parse(serializedSession).token, "mock-password-account-token");
    assert.ok(
      state.calls.some((call) =>
        call.method === "GET" &&
        call.path === "/auth/me" &&
        call.authorization === "Bearer mock-password-account-token"),
      `${label}: authenticated Daily007 requests no longer use the password-account token.`,
    );
    assert.equal(state.unexpectedRequests.length, 0, state.unexpectedRequests.join("; "));
  };

  const openProfileScenario = async (scenarioName) => {
    const linkedScenario = scenarioName === "profile-link-already-linked";
    const expectedGoogleState = linkedScenario
      ? `document.body.innerText.includes("GOOGLE CONNECTED")
        && document.body.innerText.includes("Google connection confirmed.")
        && !document.querySelector('[data-testid="continue-with-google"]')`
      : `document.body.innerText.includes("CONNECT GOOGLE")
        && Boolean(document.querySelector('[data-testid="continue-with-google"]'))`;
    await cdp("Page.navigate", {
      url: `${previewUrl(vitePort)}?scenario=${scenarioName}`,
    });
    await waitForExpression(
      `Boolean(document.querySelector('[data-testid="mock-tab-profile"]'))
        && window.__daily007GoogleSignupWalletTest.snapshot()
          .then((state) => state.currentSession?.id === "mock-password-player"
            && state.storedSession?.token === "mock-password-account-token"
            && state.currentSession?.googleLinked === ${linkedScenario}
            && state.calls.some((call) => call.method === "GET" && call.path === "/me/stats"))`,
      `the saved password-account session and Profile tab for ${scenarioName}`,
    );
    await clickSelector('[data-testid="mock-tab-profile"]', "Profile tab");
    await waitForExpression(
      `${expectedGoogleState}
        && document.body.innerText.includes("Mock Password Player")
        && document.body.innerText.includes("🪙 42")`,
      `the real Profile screen for ${scenarioName}`,
    );
  };

  const assertWalletBalance = async (label) => {
    await clickSelector('[data-testid="mock-tab-wallet"]', "Wallet tab");
    await waitForExpression(
      `Boolean(document.querySelector('[aria-label="Available coins: 42"]'))`,
      `${label}: the existing 42-coin Wallet balance`,
    );
    const walletLabel = await evaluate(
      `document.querySelector('[aria-label="Available coins: 42"]')?.getAttribute("aria-label") ?? null`,
    );
    assert.equal(walletLabel, "Available coins: 42", `${label}: Wallet balance did not remain available.`);
  };

  await openProfileScenario("profile-link-success");
  const beforeLink = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(beforeLink, "before Google linking");
  await assertWalletBalance("before Google linking");
  await clickSelector('[data-testid="mock-tab-profile"]', "return to Profile before linking");
  await waitForExpression(
    `document.body.innerText.includes("CONNECT GOOGLE")`,
    "Profile after checking the password-account Wallet",
  );
  await clickSelector('[data-testid="continue-with-google"]', "Connect Google on the real Profile screen");
  await waitForExpression(
    `document.body.innerText.includes("Google connection confirmed.")`,
    "the successful Profile Google-link confirmation",
  );
  await waitForExpression(
    `window.__daily007GoogleSignupWalletTest.snapshot()
      .then((state) => state.calls.filter((call) => call.method === "GET" && call.path === "/auth/me").length >= 3)`,
    "Profile's authenticated refresh after linking Google",
  );
  const appInfo = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="profile-app-metadata"]');
    return { text: card?.innerText ?? null, pageText: document.body.innerText };
  })()`);
  assert.ok(appInfo.pageText.includes("APP INFO"), "Profile should include an app information section.");
  assert.ok(appInfo.text?.includes(expectedAppVersion), "Profile should show the native app version.");
  assert.ok(appInfo.text?.includes("Android build"), "Android should be identified as the build value.");
  assert.ok(appInfo.text?.includes(expectedAndroidBuild), "Profile should show the native Android build number.");
  const largeTextMetadata = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="profile-app-metadata"]');
    if (!card) return null;
    const leaves = [...card.querySelectorAll("*")].filter((node) =>
      node.children.length === 0 && node.textContent?.trim(),
    );
    for (const leaf of leaves) leaf.style.setProperty("font-size", "19.5px", "important");
    return {
      text: card.innerText,
      clientWidth: card.clientWidth,
      scrollWidth: card.scrollWidth,
      leaves: leaves.map((leaf) => ({
        text: leaf.textContent.trim(),
        width: leaf.getBoundingClientRect().width,
        height: leaf.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(leaf).fontSize),
      })),
    };
  })()`);
  assert.ok(largeTextMetadata, "The app information card should remain present at large text.");
  assert.ok(largeTextMetadata.text.includes(expectedAppVersion));
  assert.ok(largeTextMetadata.text.includes(expectedAndroidBuild));
  assert.ok(
    largeTextMetadata.scrollWidth <= largeTextMetadata.clientWidth + 1,
    "The app information card should not overflow horizontally at 1.5× text size.",
  );
  assert.ok(
    largeTextMetadata.leaves.every((leaf) => leaf.width > 0 && leaf.height > 0 && leaf.fontSize >= 19.5),
    "App version labels and values should remain visible at 1.5× text size.",
  );
  const successfulLink = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(successfulLink, "after successful Google linking");
  const successfulExchange = successfulLink.calls.filter(
    (call) => call.method === "POST" && call.path === "/auth/google",
  );
  assert.equal(successfulExchange.length, 1, "Profile should make one Google-link exchange.");
  assert.equal(successfulExchange[0].status, 200);
  assert.equal(successfulExchange[0].authorization, "Bearer mock-clerk-verified-token");
  assert.equal(successfulExchange[0].daily007Token, "mock-password-account-token");
  assert.ok(successfulLink.clerk.events.includes("get-token"));
  await assertWalletBalance("after successful Google linking");

  await openProfileScenario("profile-link-cancel");
  const beforeCancel = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(beforeCancel, "before cancelling Google linking");
  await clickSelector('[data-testid="continue-with-google"]', "Connect Google before cancelling");
  await waitForExpression(
    `window.__daily007GoogleSignupWalletTest.snapshot()
      .then((state) => state.clerk.events.includes("start-sso")
        && !state.calls.some((call) => call.method === "POST" && call.path === "/auth/google"))
      && [...document.querySelectorAll('[data-testid="continue-with-google"]')]
        .some((button) => button.textContent?.includes("Connect Google"))`,
    "the cancelled OAuth flow to return to Profile without an exchange",
  );
  const cancelledLink = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(cancelledLink, "after cancelling Google linking");
  assert.equal(cancelledLink.googleExchangeAttempts, 0, "Cancellation must not exchange a Google token.");
  assert.deepEqual(cancelledLink.clerk.events, ["start-sso"]);
  const cancelledView = await evaluate(
    `document.body.innerText.includes("Google connection confirmed.")`,
  );
  assert.equal(cancelledView, false, "A cancelled OAuth flow must not show a successful link.");
  await assertWalletBalance("after cancelling Google linking");

  await openProfileScenario("profile-link-error");
  const beforeLinkError = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(beforeLinkError, "before the failed Google-link exchange");
  await clickSelector('[data-testid="continue-with-google"]', "Connect Google before the API error");
  await waitForExpression(
    `document.body.innerText.includes("Google linking is temporarily unavailable. Please try again.")`,
    "the recoverable Profile message after a failed Google-link exchange",
  );
  const failedLink = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(failedLink, "after the failed Google-link exchange");
  const failedExchange = failedLink.calls.filter(
    (call) => call.method === "POST" && call.path === "/auth/google",
  );
  assert.equal(failedExchange.length, 1);
  assert.equal(failedExchange[0].status, 503);
  assert.equal(failedExchange[0].authorization, "Bearer mock-clerk-verified-token");
  assert.equal(failedExchange[0].daily007Token, "mock-password-account-token");
  const failedView = await evaluate(
    `document.body.innerText.includes("Google connection confirmed.")`,
  );
  assert.equal(failedView, false, "A failed link must not show a successful connection.");
  await assertWalletBalance("after the failed Google-link exchange");

  await openProfileScenario("profile-link-storage-failure");
  const beforeLinkStorageFailure = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(beforeLinkStorageFailure, "before the Google-link session-storage failure");
  const storageMetricsBeforeLink = beforeLinkStorageFailure.storageWriteMetrics;
  assert.equal(
    await evaluate("window.__daily007GoogleSignupWalletTest.rejectNextSessionWrite()"),
    true,
    "The isolated storage mock should reject the next session write.",
  );
  await clickSelector(
    '[data-testid="continue-with-google"]',
    "Connect Google before rejecting the completed link's session write",
  );
  await waitForExpression(
    `document.body.innerText.includes("Daily007 could not save your session on this device. Check available storage and try again.")`,
    "the recoverable Profile message after Google linking succeeds but session storage rejects the write",
  );
  const linkStorageFailure = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(linkStorageFailure, "after the Google-link session-storage failure");
  assert.equal(
    linkStorageFailure.storageWriteMetrics.sessionWriteAttempts,
    storageMetricsBeforeLink.sessionWriteAttempts + 1,
    "The successful link should attempt exactly one refreshed-session write.",
  );
  assert.equal(
    linkStorageFailure.storageWriteMetrics.rejectedSessionWrites,
    storageMetricsBeforeLink.rejectedSessionWrites + 1,
    "AsyncStorage should reject the refreshed-session write.",
  );
  const completedLink = linkStorageFailure.calls.filter(
    (call) => call.method === "POST" && call.path === "/auth/google",
  );
  assert.equal(completedLink.length, 1, "Profile should make one Google-link exchange.");
  assert.equal(completedLink[0].status, 200, "The server-side Google link should complete before storage rejects.");
  assert.equal(completedLink[0].authorization, "Bearer mock-clerk-verified-token");
  assert.equal(completedLink[0].daily007Token, "mock-password-account-token");
  assert.ok(linkStorageFailure.clerk.events.includes("get-token"));

  await assertWalletBalance("after Google linking succeeds but session storage rejects the write");
  const walletAfterLinkStorageFailure = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(walletAfterLinkStorageFailure, "after opening Wallet following the failed session write");
  const passwordWalletRequests = walletAfterLinkStorageFailure.calls.filter(
    (call) => call.method === "GET" && call.path === "/wallet/transactions",
  );
  assert.ok(passwordWalletRequests.length > 0, "Wallet should remain accessible after the failed local write.");
  assert.ok(
    passwordWalletRequests.every(
      (call) => call.authorization === "Bearer mock-password-account-token",
    ),
    "Wallet requests must keep using the original password-account bearer token.",
  );

  await clickSelector('[data-testid="mock-tab-profile"]', "return to Profile after the successful server link");
  await waitForExpression(
    `document.body.innerText.includes("Google connection confirmed.")
      && !document.querySelector('[data-testid="continue-with-google"]')`,
    "server-confirmed linked state after navigating back to Profile",
  );
  const linkedAfterNavigation = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(linkedAfterNavigation, "after refreshing Google status on Profile focus");
  assert.equal(linkedAfterNavigation.currentSession?.googleLinked, true);
  assert.equal(linkedAfterNavigation.storedSession?.googleLinked, true);
  assert.equal(linkedAfterNavigation.currentSession?.id, "mock-password-player");
  assert.equal(linkedAfterNavigation.currentSession?.coins, 42);
  assert.equal(linkedAfterNavigation.currentSession?.token, "mock-password-account-token");

  await openProfileScenario("profile-link-already-linked");
  const alreadyLinked = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(alreadyLinked, "after restoring an already-linked Google account");
  assert.equal(alreadyLinked.currentSession?.googleLinked, true);
  assert.equal(alreadyLinked.storedSession?.googleLinked, true);
  assert.equal(
    alreadyLinked.calls.filter((call) => call.method === "POST" && call.path === "/auth/google").length,
    0,
    "Profile must not ask an already-linked account to connect again.",
  );
  const alreadyLinkedView = await evaluate(`(() => ({
    connectedMessage: document.querySelector('[data-testid="profile-google-connected"]')?.textContent?.trim() ?? null,
    connectButtonVisible: Boolean(document.querySelector('[data-testid="continue-with-google"]')),
  }))()`);
  assert.equal(alreadyLinkedView.connectedMessage, "Google connection confirmed.");
  assert.equal(alreadyLinkedView.connectButtonVisible, false);
  await assertWalletBalance("after restoring an already-linked Google account");
  const walletForAlreadyLinked = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  assertPasswordSession(walletForAlreadyLinked, "after opening Wallet for an already-linked Google account");

  assert.deepEqual(browserErrors, [], `Browser errors during mocked Google auth flows: ${browserErrors.join(" | ")}`);
  console.log(
    "PASS — Google signup API/storage retries, password signup session-storage recovery, and Profile Google-link success/cancel/error/storage-failure scenarios.",
  );
} finally {
  socket?.close();
  await stopProcess(chromium);
  await stopProcess(vite);
  if (temporaryProfile) {
    await rm(temporaryProfile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
