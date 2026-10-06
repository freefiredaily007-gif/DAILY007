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
    `document.body.innerText.includes("Daily007 signup exchange is temporarily unavailable. Please try again.")`,
    "retryable Daily007 exchange error after the first Google signup attempt",
  );
  const failedAttempt = await evaluate("window.__daily007GoogleSignupWalletTest.snapshot()");
  const failureView = await evaluate(`(() => {
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

  assert.equal(failedAttempt.googleExchangeAttempts, 1, "The first Daily007 exchange should fail exactly once.");
  assert.deepEqual(failedAttempt.sessionStorage, {}, "A failed exchange must leave Daily007 session storage empty.");
  assert.equal(failedAttempt.storedSession, null, "A failed exchange must not persist a Daily007 session.");
  assert.equal(failedAttempt.calls.at(-1)?.status, 503, "The first Google exchange should return the mocked failure.");
  assert.equal(failureView.signupFieldsVisible, true, "The signup form should remain usable after the exchange failure.");
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
  assert.deepEqual(googleExchange.map((call) => call.status), [503, 200]);
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
    await cdp("Page.navigate", {
      url: `${previewUrl(vitePort)}?scenario=${scenarioName}`,
    });
    await waitForExpression(
      `Boolean(document.querySelector('[data-testid="mock-tab-profile"]'))
        && window.__daily007GoogleSignupWalletTest.snapshot()
          .then((state) => state.currentSession?.id === "mock-password-player"
            && state.storedSession?.token === "mock-password-account-token")`,
      `the saved password-account session and Profile tab for ${scenarioName}`,
    );
    await clickSelector('[data-testid="mock-tab-profile"]', "Profile tab");
    await waitForExpression(
      `document.body.innerText.includes("CONNECT GOOGLE")
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
      .then((state) => state.calls.filter((call) => call.method === "GET" && call.path === "/auth/me").length >= 2)`,
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

  assert.deepEqual(browserErrors, [], `Browser errors during mocked Google auth flows: ${browserErrors.join(" | ")}`);
  console.log(
    "PASS — mocked Google signup recovers from API and storage failures; real Profile Google linking preserves the password account, wallet, and token on success, cancellation, and exchange error.",
  );
} finally {
  socket?.close();
  await stopProcess(chromium);
  await stopProcess(vite);
  if (temporaryProfile) await rm(temporaryProfile, { recursive: true, force: true });
}
