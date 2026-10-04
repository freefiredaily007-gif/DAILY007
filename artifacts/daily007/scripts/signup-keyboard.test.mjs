import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const daily007Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(daily007Root, "../..");
const sandboxRoot = path.resolve(daily007Root, "../mockup-sandbox");
const browserErrors = [];
const pending = new Map();
let viteOutput = "";
let vite;
let chromium;
let socket;
let temporaryProfile;
let vitePort;
let messageId = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local port.");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitFor(url, label, processToWatch) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (processToWatch?.exitCode !== null && processToWatch?.exitCode !== undefined) {
      throw new Error(`${label} exited with code ${processToWatch.exitCode}.`);
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
  throw new Error(`${label} did not become ready: ${lastError?.message ?? "timeout"}`);
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
          browserErrors.push(details?.exception?.description ?? details?.text ?? "Browser exception.");
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          browserErrors.push(
            message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ")
              || "Browser console error.",
          );
        }
        if (!message.id) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
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
  const id = ++messageId;
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

async function waitForCondition(expression, description) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return;
    await delay(100);
  }
  const state = await evaluate(`(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 900),
    root: document.querySelector("#root")?.innerHTML.slice(0, 500) ?? "",
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height
    }
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(`${description} did not render: ${JSON.stringify(state)}`);
}

async function setDeviceViewport(height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height,
    screenWidth: 375,
    screenHeight: 720,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitForCondition(
    `window.innerWidth === 375 && window.innerHeight === ${height}`,
    `375×720 device viewport with ${height}px available height`,
  );
}

async function focusAndRevealInput(selector) {
  return evaluate(`(() => new Promise((resolve) => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return resolve({ error: "input not found" });
    input.focus({ preventScroll: true });

    let scroll = input.parentElement;
    while (scroll && scroll !== document.documentElement) {
      const overflowY = getComputedStyle(scroll).overflowY;
      if (/(auto|scroll)/.test(overflowY) && scroll.scrollHeight > scroll.clientHeight + 1) break;
      scroll = scroll.parentElement;
    }
    if (!scroll || scroll === document.documentElement) {
      return resolve({ error: "scrollable form container not found" });
    }

    const containerRect = scroll.getBoundingClientRect();
    const visibleTop = Math.max(0, containerRect.top);
    const visibleBottom = Math.min(window.innerHeight, containerRect.bottom);
    const inputRect = input.getBoundingClientRect();
    const margin = 12;
    if (inputRect.top < visibleTop + margin) {
      scroll.scrollTop += inputRect.top - visibleTop - margin;
    } else if (inputRect.bottom > visibleBottom - margin) {
      scroll.scrollTop += inputRect.bottom - visibleBottom + margin;
    }

    requestAnimationFrame(() => {
      const visibleRect = input.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      resolve({
        focused: document.activeElement === input,
        keyboardVisible: window.innerHeight < window.screen.height,
        scrollable: scroll.scrollHeight > scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        fieldTop: visibleRect.top,
        fieldBottom: visibleRect.bottom,
        viewportTop: Math.max(0, scrollRect.top),
        viewportBottom: Math.min(window.innerHeight, scrollRect.bottom),
      });
    });
  }))()`);
}

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-signup-keyboard-"));
  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@workspace/mockup-sandbox",
      "exec",
      "vite",
      "--config",
      "vite.signup-keyboard.config.ts",
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
  await waitFor(
    `http://127.0.0.1:${vitePort}/signup-keyboard-preview.html`,
    "Signup keyboard Vite preview",
    vite,
  );

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
  assert(pageTarget, "Chromium did not expose a page target.");
  await connectCdp(pageTarget.webSocketDebuggerUrl);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 720,
    screenWidth: 375,
    screenHeight: 720,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/signup-keyboard-preview.html`,
  });
  await waitForCondition(
    `Boolean(window.__daily007SignupKeyboardTest?.ready)`,
    "Isolated signup preview",
  );
  await waitForCondition(
    "window.innerWidth === 375 && window.innerHeight === 720 && window.screen.width === 375 && window.screen.height === 720",
    "375×720 emulated device screen",
  );

  const signupTabClicked = await evaluate(`(() => {
    const label = [...document.querySelectorAll("*")].find((node) =>
      node.childElementCount === 0 && node.textContent?.trim() === "SIGN UP"
    );
    if (!label) return false;
    label.click();
    return true;
  })()`);
  assert(signupTabClicked, "Could not open the signup form.");
  await waitForCondition(
    `Boolean(document.querySelector('input[placeholder="Enter Name"]') &&
      document.querySelector('input[placeholder="Referral Code (Optional)"]') &&
      document.querySelector('input[placeholder="Enter Email"]') &&
      document.querySelector('input[placeholder^="Password"]'))`,
    "Signup fields",
  );

  // Chromium has no software keyboard. Keep the device screen at 375×720 and
  // reduce the available app viewport by 300px to model the open keyboard.
  await setDeviceViewport(420);
  const fields = [
    ["Name", 'input[placeholder="Enter Name"]'],
    ["Referral", 'input[placeholder="Referral Code (Optional)"]'],
    ["Email", 'input[placeholder="Enter Email"]'],
    ["Password", 'input[placeholder^="Password"]'],
  ];
  let previousScrollTop = 0;
  for (const [name, selector] of fields) {
    const state = await focusAndRevealInput(selector);
    assert(
      state?.focused && state.keyboardVisible && state.scrollable &&
        state.fieldTop >= state.viewportTop - 1 &&
        state.fieldBottom <= state.viewportBottom + 1,
      `${name} was not focused and visible above the keyboard: ${JSON.stringify(state)}.`,
    );
    if (state.scrollTop > previousScrollTop) previousScrollTop = state.scrollTop;
    console.log(`PASS — ${name} stays focused and visible with the keyboard open.`);
  }
  assert(previousScrollTop > 0, "The signup form did not scroll to reveal its lower fields.");

  await setDeviceViewport(720);
  const submitState = await evaluate(`(() => new Promise((resolve) => {
    const button = document.querySelector('[aria-label="CREATE ACCOUNT"]');
    if (!button) return resolve({ error: "Create Account button not found" });
    let scroll = button.parentElement;
    while (scroll && scroll !== document.documentElement) {
      const overflowY = getComputedStyle(scroll).overflowY;
      if (/(auto|scroll)/.test(overflowY) && scroll.scrollHeight > scroll.clientHeight + 1) break;
      scroll = scroll.parentElement;
    }
    if (scroll && scroll !== document.documentElement) scroll.scrollTop = scroll.scrollHeight;
    requestAnimationFrame(() => {
      const rect = button.getBoundingClientRect();
      resolve({
        visible: rect.top >= 0 && rect.bottom <= window.innerHeight,
        keyboardClosed: window.innerHeight === window.screen.height,
        registerCalls: window.__daily007SignupKeyboardTest.getRegisterCalls(),
        top: rect.top,
        bottom: rect.bottom,
        height: window.innerHeight,
      });
    });
  }))()`);
  assert(
    submitState?.visible && submitState.keyboardClosed && submitState.registerCalls === 0,
    `Create Account was not reachable after closing the keyboard, or a signup request escaped the stub: ${JSON.stringify(submitState)}.`,
  );
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log("PASS — Create Account is reachable after the keyboard closes; no account creation request was made.");
} catch (error) {
  console.error(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
  if (browserErrors.length) console.error(`Browser errors: ${browserErrors.join(" | ")}`);
  if (viteOutput.trim()) console.error(`Vite output:\n${viteOutput.trim()}`);
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  for (const child of [chromium, vite]) {
    if (!child || child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (temporaryProfile) {
    await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}