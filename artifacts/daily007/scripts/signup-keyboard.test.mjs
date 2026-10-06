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

async function pressKeyboardAction() {
  const key = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...key });
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
        enterKeyHint: input.getAttribute("enterkeyhint"),
      });
    });
  }))()`);
}

async function inspectFocusedInput(selector) {
  return evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return { error: "input not found" };

    let scroll = input.parentElement;
    while (scroll && scroll !== document.documentElement) {
      const overflowY = getComputedStyle(scroll).overflowY;
      if (/(auto|scroll)/.test(overflowY) && scroll.scrollHeight > scroll.clientHeight + 1) break;
      scroll = scroll.parentElement;
    }

    const fieldRect = input.getBoundingClientRect();
    const scrollRect = scroll && scroll !== document.documentElement
      ? scroll.getBoundingClientRect()
      : null;
    return {
      focused: document.activeElement === input,
      keyboardVisible: window.innerHeight < window.screen.height,
      scrollable: Boolean(scrollRect),
      scrollTop: scrollRect ? scroll.scrollTop : 0,
      fieldTop: fieldRect.top,
      fieldBottom: fieldRect.bottom,
      viewportTop: scrollRect ? Math.max(0, scrollRect.top) : 0,
      viewportBottom: scrollRect ? Math.min(window.innerHeight, scrollRect.bottom) : 0,
      enterKeyHint: input.getAttribute("enterkeyhint"),
    };
  })()`);
}

async function verifyKeyboardFlow(fields, scenario, requireScroll = false) {
  await setDeviceViewport(420);
  const [firstName, firstSelector, firstHint] = fields[0];
  let state = await focusAndRevealInput(firstSelector);
  assert(
    state?.focused && state.keyboardVisible && state.scrollable &&
      state.fieldTop >= state.viewportTop - 1 &&
      state.fieldBottom <= state.viewportBottom + 1,
    `${scenario}: ${firstName} was not focused and visible above the open keyboard: ${JSON.stringify(state)}.`,
  );
  assert(
    state.enterKeyHint === firstHint,
    `${scenario}: ${firstName} does not offer the ${firstHint} keyboard action: ${JSON.stringify(state)}.`,
  );
  console.log(`PASS — ${scenario}: ${firstName} is focused and visible above the open keyboard.`);

  let maxScrollTop = state.scrollTop;
  for (let index = 1; index < fields.length; index += 1) {
    const [name, selector, enterKeyHint] = fields[index];
    await pressKeyboardAction();
    await waitForCondition(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
      `${scenario}: ${name} focus after the keyboard Next action`,
    );
    state = await inspectFocusedInput(selector);
    assert(
      state?.focused && state.keyboardVisible && state.scrollable &&
        state.fieldTop >= state.viewportTop - 1 &&
        state.fieldBottom <= state.viewportBottom + 1,
      `${scenario}: ${name} did not stay focused and visible above the keyboard after Next: ${JSON.stringify(state)}.`,
    );
    assert(
      state.enterKeyHint === enterKeyHint,
      `${scenario}: ${name} offers ${state.enterKeyHint ?? "no"} keyboard action instead of ${enterKeyHint}: ${JSON.stringify(state)}.`,
    );
    if (state.scrollTop > maxScrollTop) maxScrollTop = state.scrollTop;
    console.log(`PASS — ${scenario}: Next focuses ${name}, which stays visible with the keyboard open.`);
  }
  if (requireScroll) {
    assert(maxScrollTop > 0, `${scenario}: the signup form did not scroll to reveal its lower fields.`);
  }

  const [lastName, lastSelector] = fields[fields.length - 1];
  await pressKeyboardAction();
  await waitForCondition(
    `document.activeElement !== document.querySelector(${JSON.stringify(lastSelector)})`,
    `${scenario}: ${lastName} Done action to dismiss the keyboard`,
  );
  assert(
    await evaluate("window.__daily007SignupKeyboardTest.getRegisterCalls() === 0"),
    `${scenario}: the final keyboard action sent a signup request.`,
  );
  await setDeviceViewport(720);
}

async function assertCreateAccountReachable(scenario) {
  const submitState = await evaluate(`(() => new Promise((resolve) => {
    const button = document.querySelector('[aria-label="Create Account"]');
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
    `${scenario}: Create Account was not reachable after Done, or a signup request escaped the stub: ${JSON.stringify(submitState)}.`,
  );
  console.log(`PASS — ${scenario}: Done dismisses the keyboard and Create Account is reachable; no account request was made.`);
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
  const initialAccessibility = await evaluate(`(() => ({
    fields: [...document.querySelectorAll("input")].map((input) => input.getAttribute("aria-label")),
    createAccount: document.querySelector('[aria-label="Create Account"]')?.getAttribute("aria-label") ?? null,
    createAccountFollowsPassword: Boolean(
      document.querySelector('input[aria-label="Password"]')?.compareDocumentPosition(
        document.querySelector('[aria-label="Create Account"]'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  }))()`);
  assert(
    JSON.stringify(initialAccessibility) === JSON.stringify({
      fields: ["Name", "Referral Code, optional", "Email", "Password"],
      createAccount: "Create Account",
      createAccountFollowsPassword: true,
    }),
    `Signup controls did not expose clear accessible names in visible order: ${JSON.stringify(initialAccessibility)}.`,
  );

  // Chromium has no software keyboard. Keep the device screen at 375×720 and
  // reduce the available app viewport by 300px to model the open keyboard.
  const fields = [
    ["Name", 'input[placeholder="Enter Name"]', "next"],
    ["Referral", 'input[placeholder="Referral Code (Optional)"]', "next"],
    ["Email", 'input[placeholder="Enter Email"]', "next"],
    ["Password", 'input[placeholder^="Password"]', "done"],
  ];
  await verifyKeyboardFlow(fields, "Signup without a prefilled referral", true);
  for (const [selector, text] of [
    ['input[placeholder="Enter Name"]', "Test Player"],
    ['input[placeholder="Enter Email"]', "test@example.invalid"],
    ['input[placeholder^="Password"]', "not-a-real-password"],
  ]) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
    await cdp("Input.insertText", { text });
  }
  const filledAccessibility = await evaluate(`(() => ({
    fields: [...document.querySelectorAll("input")].map((input) => ({
      label: input.getAttribute("aria-label"),
      hasValue: Boolean(input.value),
    })),
  }))()`);
  assert(
    JSON.stringify(filledAccessibility) === JSON.stringify({
      fields: [
        { label: "Name", hasValue: true },
        { label: "Referral Code, optional", hasValue: false },
        { label: "Email", hasValue: true },
        { label: "Password", hasValue: true },
      ],
    }),
    `Signup labels changed or disappeared after fields contained text: ${JSON.stringify(filledAccessibility)}.`,
  );
  await assertCreateAccountReachable("Signup without a prefilled referral");

  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/signup-keyboard-preview.html?ref=D7MAX&source=invite`,
  });
  await waitForCondition(
    `Boolean(window.__daily007SignupKeyboardTest?.ready &&
      document.querySelector('input[placeholder="Enter Name"]') &&
      document.querySelector('input[placeholder="Enter Email"]') &&
      document.querySelector('input[placeholder^="Password"]') &&
      !document.querySelector('input[placeholder="Referral Code (Optional)"]') &&
      document.body.innerText.includes("Referral code D7MAX applied"))`,
    "Signup form with prefilled D7MAX invite code and hidden referral input",
  );
  const invitedSignupFields = await evaluate(`(() => ({
    referralApplied: document.body.innerText.includes("Referral code D7MAX applied"),
    referralInputCount: document.querySelectorAll('input[placeholder="Referral Code (Optional)"]').length,
    fields: [...document.querySelectorAll("input")].map((input) => input.getAttribute("aria-label")),
  }))()`);
  assert(
    JSON.stringify(invitedSignupFields) === JSON.stringify({
      referralApplied: true,
      referralInputCount: 0,
      fields: ["Name", "Email", "Password"],
    }),
    `The valid D7MAX invite did not hide the referral input and leave Name, Email, and Password: ${JSON.stringify(invitedSignupFields)}.`,
  );
  console.log("PASS — D7MAX invite code is applied and the referral input is hidden.");

  const invitedFields = [
    ["Name", 'input[placeholder="Enter Name"]', "next"],
    ["Email", 'input[placeholder="Enter Email"]', "next"],
    ["Password", 'input[placeholder^="Password"]', "done"],
  ];
  await verifyKeyboardFlow(invitedFields, "Invite signup with hidden referral");
  await assertCreateAccountReachable("Invite signup with hidden referral");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
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