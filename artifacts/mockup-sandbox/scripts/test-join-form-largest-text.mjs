import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sandboxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const previewUrl = "/player-join-form-largest-text-preview.html";
const browserErrors = [];
const pending = new Map();
let viteOutput = "";
let vite;
let chromium;
let socket;
let temporaryProfile;
let vitePort;
let messageId = 0;
const inputValueSelectors = [
  'input[placeholder="Captain Free Fire in-game name"]',
  'input[placeholder="Captain Free Fire UID"]',
  'input[placeholder="Team name"]',
  'input[placeholder="Teammate 1 Free Fire in-game name"]',
  'input[placeholder="Teammate 2 Free Fire in-game name"]',
  'input[placeholder="Teammate 3 Free Fire in-game name"]',
];

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
          browserErrors.push(message.params.exceptionDetails?.exception?.description ?? "Browser exception.");
        } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ");
          browserErrors.push(text || "Browser console error.");
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
  const text = await evaluate("document.body.innerText.slice(0, 700)").catch(() => "");
  throw new Error(`${description} did not render. Page text: ${text}`);
}

async function checkLayout(width, height) {
  const state = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="player-screen"]');
    if (!root) return { missingRoot: true };
    const rootRect = root.getBoundingClientRect();
    const textIssues = [];
    for (const node of [...root.querySelectorAll('*')].filter((item) =>
      item.children.length === 0 && item.textContent?.trim() && item.getBoundingClientRect().width > 0
    )) {
      const rect = node.getBoundingClientRect();
      if (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2) {
        textIssues.push({ text: node.textContent.trim(), size: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight] });
      }
      let parent = node.parentElement;
      while (parent && parent !== root) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        const clippedX = ['hidden', 'clip'].includes(style.overflowX) && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2);
        const clippedY = ['hidden', 'clip'].includes(style.overflowY) && (rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2);
        if (clippedX || clippedY) {
          textIssues.push({ text: node.textContent.trim(), clippedBy: parent.tagName });
          break;
        }
        parent = parent.parentElement;
      }
    }
    const fields = [...root.querySelectorAll('input')].map((input) => {
      const rect = input.getBoundingClientRect();
      return {
        label: input.getAttribute('aria-label'),
        placeholder: input.getAttribute('placeholder'),
        fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
        height: rect.height,
        width: rect.width,
        left: rect.left,
        right: rect.right,
        readOnly: input.readOnly,
      };
    });
    const scroll = [...root.querySelectorAll('*')].find((node) => {
      const style = getComputedStyle(node);
      return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    });
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      root: [rootRect.left, rootRect.right, rootRect.top, rootRect.bottom],
      textIssues,
      fields,
      scroll: scroll ? { clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop } : null,
    };
  })()`);
  assert(!state.missingRoot, `The registration screen did not mount at ${width}px.`);
  assert(state.width === width, `The registration preview was not rendered at ${width}px.`);
  assert(state.height === height, `The registration preview was not rendered at ${height}px tall.`);
  assert(state.documentWidth <= width + 1, `The registration screen overflows horizontally at ${width}px.`);
  assert(state.textIssues.length === 0, `Registration text is clipped at ${width}px: ${JSON.stringify(state.textIssues.slice(0, 8))}`);
  const expectedLabels = [
    "Captain Daily007 profile name, read-only",
    "Captain Free Fire in-game name",
    "Captain Free Fire UID",
    "Team name",
    "Teammate 1 Free Fire in-game name",
    "Teammate 1 Free Fire UID, optional",
    "Teammate 2 Free Fire in-game name",
    "Teammate 2 Free Fire UID, optional",
    "Teammate 3 Free Fire in-game name",
    "Teammate 3 Free Fire UID, optional",
  ];
  assert(
    expectedLabels.every((label) => state.fields.some((field) => field.label === label)),
    `A captain, team, or teammate field is missing its accessible label at ${width}px: ${JSON.stringify(state.fields)}`,
  );
  assert(
    state.fields.every((field) =>
      field.width >= 200
        && field.height >= 44
        && field.fontSize >= 30
        && field.left >= state.root[0] - 1
        && field.right <= state.root[1] + 1
    ),
    `A registration field is too small, too short, or outside the phone viewport at ${width}px: ${JSON.stringify(state.fields)}`,
  );
  assert(
    state.scroll && state.scroll.scrollHeight > state.scroll.clientHeight + 100,
    `The Squad registration did not expose a usable vertical scroll area at ${width}px: ${JSON.stringify(state.scroll)}`,
  );
  return state;
}

async function setViewport(width, height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(120);
}

async function checkReachable(selector, description, width) {
  const state = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="player-screen"]');
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    let parent = target.parentElement;
    let scroller = null;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        scroller = parent;
        parent.scrollTop = parent.scrollHeight;
        break;
      }
      parent = parent.parentElement;
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      text: target.textContent.trim(),
      disabled: target.disabled === true || target.getAttribute('aria-disabled') === 'true',
      bounds: [rect.left, rect.right, rect.top, rect.bottom],
      root: [rootRect.left, rootRect.right, rootRect.top, rootRect.bottom],
      scrollTop: scroller?.scrollTop ?? 0,
      hasScrollParent: Boolean(scroller),
    };
  })()`);
  assert(state, `${description} is missing at ${width}px.`);
  assert(!state.disabled, `${description} is disabled at ${width}px.`);
  assert(state.hasScrollParent && state.scrollTop > 0, `${description} did not require or use the form's scroll area at ${width}px: ${JSON.stringify(state)}`);
  assert(
    state.bounds[0] >= state.root[0] - 1
      && state.bounds[1] <= state.root[1] + 1
      && state.bounds[2] >= state.root[2] - 1
      && state.bounds[3] <= state.root[3] + 1
      && state.bounds[3] - state.bounds[2] >= 44,
    `${description} is not reachable with a usable tap area at ${width}px: ${JSON.stringify(state)}`,
  );
  return state;
}

async function assertFormValues(expectedValues, stage) {
  const values = await evaluate(`(() => {
    const selectors = ${JSON.stringify(inputValueSelectors)};
    return selectors.map((selector) => document.querySelector(selector)?.value ?? null);
  })()`);
  assert(
    JSON.stringify(values) === JSON.stringify(expectedValues),
    `Registration values changed ${stage}: ${JSON.stringify(values)}`,
  );
}

async function setInputValue(selector, value, description) {
  const updated = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert(updated, `Could not enter ${description}.`);
}

async function runAtWidth(width) {
  await setViewport(width, 820);
  await cdp("Page.navigate", { url: `http://127.0.0.1:${vitePort}${previewUrl}` });
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"player-screen\"]') && document.querySelector('[data-testid=\"join-form-submit\"]'))",
    "the Squad registration screen",
  );
  await delay(120);
  const layout = await checkLayout(width, 820);

  const expectedValues = [
    "Test Captain",
    "FF-TEST-CAPTAIN",
    "Test Squad",
    "Test Teammate 1",
    "Test Teammate 2",
    "Test Teammate 3",
  ];
  await setInputValue(inputValueSelectors[0], expectedValues[0], "captain name");
  await setInputValue(inputValueSelectors[1], expectedValues[1], "captain UID");
  await setInputValue(inputValueSelectors[2], expectedValues[2], "team name");
  for (let teammate = 1; teammate <= 3; teammate += 1) {
    await setInputValue(
      inputValueSelectors[teammate + 2],
      expectedValues[teammate + 2],
      `teammate ${teammate} name`,
    );
  }

  await assertFormValues(expectedValues, "before opening the keyboard");
  const teammateSelector = inputValueSelectors[5];
  const focused = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(teammateSelector)});
    input?.focus();
    return Boolean(input && document.activeElement === input);
  })()`);
  assert(focused, `Could not focus a teammate field at ${width}px.`);

  const keyboardHeight = 470;
  await setViewport(width, keyboardHeight);
  const keyboardLayout = await checkLayout(width, keyboardHeight);
  assert(
    keyboardLayout.scroll.clientHeight < layout.scroll.clientHeight,
    `The form viewport did not shrink while the keyboard was simulated at ${width}px.`,
  );
  const teammate = await checkReachable(
    teammateSelector,
    "Focused teammate field with keyboard open",
    width,
  );
  assert(teammate.scrollTop > 0, `The focused teammate field did not scroll into view at ${width}px.`);
  await assertFormValues(expectedValues, "after focusing and scrolling with the keyboard open");

  const join = await checkReachable(
    '[data-testid="join-form-submit"]',
    "Join action with keyboard open",
    width,
  );
  await evaluate(`document.querySelector('[data-testid="join-form-submit"]').click()`);
  await waitForCondition(
    "document.body.innerText.includes('Insufficient wallet balance: this entry costs 7 coins.')",
    "the simulated registration error",
  );
  assert(
    await evaluate(`window.innerHeight === ${keyboardHeight} && document.activeElement === document.querySelector(${JSON.stringify(teammateSelector)})`),
    `Submitting with the keyboard open unexpectedly dismissed it at ${width}px.`,
  );
  const cancel = await checkReachable(
    '[data-testid="join-form-cancel"]',
    "Cancel action with keyboard open",
    width,
  );
  await evaluate(`document.querySelector('[data-testid="join-form-cancel"]').click()`);
  await waitForCondition("window.__joinFormCancelCount === 1", "the Cancel action");
  assert(
    !(await evaluate("document.body.innerText.includes('Registration confirmed')")),
    `A rejected registration showed a success message at ${width}px.`,
  );
  assert(
    await evaluate(`window.innerHeight === ${keyboardHeight} && document.activeElement === document.querySelector(${JSON.stringify(teammateSelector)})`),
    `Cancel with the keyboard open unexpectedly dismissed it at ${width}px.`,
  );
  await assertFormValues(expectedValues, "after using Join and Cancel with the keyboard open");

  await evaluate(`document.querySelector(${JSON.stringify(teammateSelector)}).blur()`);
  await setViewport(width, 820);
  const dismissedKeyboardLayout = await checkLayout(width, 820);
  assert(
    dismissedKeyboardLayout.scroll.scrollHeight > dismissedKeyboardLayout.scroll.clientHeight + 100,
    `The form stopped scrolling after keyboard dismissal at ${width}px.`,
  );
  const joinDismissed = await checkReachable(
    '[data-testid="join-form-submit"]',
    "Join action after keyboard dismissal",
    width,
  );
  const cancelDismissed = await checkReachable(
    '[data-testid="join-form-cancel"]',
    "Cancel action after keyboard dismissal",
    width,
  );
  await assertFormValues(expectedValues, "after keyboard dismissal and scrolling");

  console.log(
    `PASS — Squad registration at ${width}px and 2× Android text scale; ${layout.fields.length} fields, focused teammate and Join/Cancel reachable with keyboard open and dismissed (open scrollTop ${teammate.scrollTop}/${join.scrollTop}/${cancel.scrollTop}; dismissed ${joinDismissed.scrollTop}/${cancelDismissed.scrollTop}).`,
  );
}

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-join-form-large-text-"));
  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@workspace/mockup-sandbox",
      "exec",
      "vite",
      "--config",
      "vite.join-form-largest-text.config.ts",
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
  await waitFor(`http://127.0.0.1:${vitePort}${previewUrl}`, "JoinForm Vite preview", vite);

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
      `http://127.0.0.1:${vitePort}${previewUrl}`,
    ],
    { stdio: "ignore" },
  );
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, "Headless Chromium", chromium);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  assert(pageTarget, "Chromium did not expose a page target.");
  await connectCdp(pageTarget.webSocketDebuggerUrl);
  await cdp("Page.enable");
  await cdp("Runtime.enable");

  for (const width of [375, 320]) await runAtWidth(width);
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
