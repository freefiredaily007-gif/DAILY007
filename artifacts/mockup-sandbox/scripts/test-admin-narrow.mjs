import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sandboxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const adminTabs = [
  ["dashboard", "Dashboard"],
  ["leaderboards", "Rewards"],
  ["tournaments", "Tournaments"],
  ["registrations", "Regs"],
  ["payments", "Payments"],
  ["wallet", "Wallet"],
  ["earnTasks", "Earn"],
  ["videos", "Videos"],
  ["users", "Users"],
  ["notifications", "Notify"],
  ["settings", "Settings"],
];
const browserErrors = [];
let viteOutput = "";
let messageId = 0;
let chromium;
let vite;
let socket;
let temporaryProfile;
const pending = new Map();

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

async function waitFor(fetchUrl, label, processToWatch) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (processToWatch?.exitCode !== null && processToWatch?.exitCode !== undefined) {
      throw new Error(`${label} exited early with code ${processToWatch.exitCode}.`);
    }
    try {
      const response = await fetch(fetchUrl);
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
          browserErrors.push(JSON.stringify({
            text: details?.text,
            description: details?.exception?.description,
            stack: details?.stackTrace?.callFrames?.slice(0, 3).map((frame) => `${frame.url}:${frame.lineNumber + 1}`),
          }));
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ");
          browserErrors.push(text || "Browser console error.");
        }
        if (message.id) {
          const item = pending.get(message.id);
          if (!item) return;
          pending.delete(message.id);
          if (message.error) item.reject(new Error(message.error.message));
          else item.resolve(message.result);
        }
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

async function waitForPage() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await evaluate("Boolean(document.querySelector('#root > *'))").catch(() => false);
    if (ready) return;
    await delay(100);
  }
  const state = await evaluate(`(() => ({
    url: location.href,
    body: document.body.innerText.slice(0, 400),
    root: document.querySelector('#root')?.innerHTML.slice(0, 800) ?? '',
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(`The real Admin screen did not render in the isolated preview: ${JSON.stringify(state)}`);
}

async function setViewport(width) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 820,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/admin-narrow-preview.html?run=${width}`,
  });
  await waitForPage();
  await delay(150);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function clickSelector(selector, description) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert(clicked, `Could not find ${description}.`);
  await delay(130);
}

async function clickButton(text) {
  const clicked = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[role="button"], button')];
    const button = buttons.find((item) => item.textContent.trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Could not find the "${text}" button.`);
  await delay(130);
}

async function assertText(text, label = text) {
  const found = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('body *')];
    return nodes.some((node) =>
      node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(text)}
    );
  })()`);
  assert(found, `Expected ${label} to be visible.`);
}

async function assertHorizontalFit(selector, description, width) {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: element.textContent?.trim() ?? '',
    };
  })()`);
  assert(result, `${description} is missing at ${width}px.`);
  assert(result.left >= -1 && result.right <= width + 1, `${description} extends outside the ${width}px viewport.`);
  assert(
    result.scrollWidth <= result.clientWidth + 2,
    `${description} is clipped horizontally at ${width}px (content ${result.scrollWidth}px, box ${result.clientWidth}px).`,
  );
}

async function checkAdminTabs(width) {
  const initial = await evaluate(`(() => {
    const item = document.querySelector('[data-testid="admin-tab-dashboard"]');
    if (!item) return null;
    const style = getComputedStyle(item);
    return { background: style.backgroundColor, border: style.borderColor };
  })()`);
  assert(initial, `The Dashboard tab selector is missing at ${width}px.`);

  for (const [key, label] of adminTabs) {
    await clickSelector(`[data-testid="admin-tab-${key}"]`, `${label} tab`);
    const selected = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="admin-tab-${key}"]');
      if (!item) return null;
      const style = getComputedStyle(item);
      const label = item.lastElementChild;
      const labelRect = label?.getBoundingClientRect();
      let scrollport = item.parentElement;
      while (scrollport && scrollport !== document.body) {
        const overflow = getComputedStyle(scrollport).overflowX;
        if ((overflow === 'auto' || overflow === 'scroll') && scrollport.scrollWidth > scrollport.clientWidth) break;
        scrollport = scrollport.parentElement;
      }
      const portRect = scrollport?.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        label: label?.textContent?.trim() ?? '',
        labelFits: !!labelRect && label.scrollWidth <= label.clientWidth + 2,
        itemVisible: !!portRect && itemRect.left >= portRect.left - 1 && itemRect.right <= portRect.right + 1,
        bodyWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert(selected, `${label} tab could not be inspected at ${width}px.`);
    assert(selected.label === label, `${label} tab label changed unexpectedly at ${width}px.`);
    assert(
      selected.background === initial.background && selected.border === initial.border,
      `${label} did not show the selected-tab style at ${width}px.`,
    );
    assert(selected.labelFits, `${label} label is clipped at ${width}px.`);
    assert(selected.itemVisible, `${label} is not scrolled into view at ${width}px.`);
    assert(selected.bodyWidth <= width + 1, `The page is horizontally wider than ${width}px on the ${label} tab.`);
  }
}

async function checkTournamentStates(width) {
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments tab");

  await clickButton("NEW");
  await assertText("CREATE TOURNAMENT");
  await assertText("GAME MODE");
  await assertText("FORMAT");
  await assertHorizontalFit('[placeholder="Tournament name *"]', "Tournament name field", width);
  await assertHorizontalFit('[placeholder="Prize distribution (e.g. 1st: 500 coins)"]', "Prize distribution field", width);
  await clickButton("CLOSE");

  await clickSelector('[data-testid="manage-room-preview-upcoming"]', "room setup action");
  const roomPanel = await evaluate(
    "Boolean(document.querySelector('[data-testid=\"inline-room-management-preview-upcoming\"]'))",
  );
  assert(roomPanel, `Room setup did not open at ${width}px.`);
  await assertText("ROOM SETUP");
  await assertText("ROOM ID");
  await assertText("ROOM PASSWORD");
  await assertHorizontalFit('[placeholder="Room ID"]', "Room ID field", width);
  await assertHorizontalFit('[placeholder="Room Password"]', "Room password field", width);

  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Ongoing tournament filter");
  await clickSelector('[data-testid="finish-tournament-preview-ongoing"]', "result entry action");
  const resultPanel = await evaluate(
    "Boolean(document.querySelector('[data-testid=\"inline-results-entry-preview-ongoing\"]'))",
  );
  assert(resultPanel, `Result entry did not open at ${width}px.`);
  await assertText("RESULT ENTRY");
  await assertText("SELECT PLAYER");
  await assertText("Preview Player One (UID TEST-UID-001)");
  await assertText("RANK");
  await assertText("KILLS");
  await assertText("PRIZE COINS · FROM SAVED TOURNAMENT SETTINGS");
  await assertHorizontalFit('[data-testid="inline-results-entry-preview-ongoing"]', "Result entry panel", width);

  await clickSelector('[data-testid="admin-tournament-tab-completed"]', "Completed tournament filter");
  const completedPanel = await evaluate(
    "Boolean(document.querySelector('[data-testid=\"completed-result-log-preview-completed\"]'))",
  );
  assert(completedPanel, `Completed-result details did not open at ${width}px.`);
  await assertText("WINNER & RESULT LOG");
  await assertText("WINNER · Preview Champion");
  await assertText("PRIZE SETTLED · 300 COINS");
  await assertText("#1 Preview Champion · 8 kills · 300 coins");
  await assertHorizontalFit(
    '[data-testid="completed-result-log-preview-completed"]',
    "Completed-result details",
    width,
  );
}

let vitePort;

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-admin-narrow-"));

  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@workspace/mockup-sandbox",
      "exec",
      "vite",
      "--config",
      "vite.admin-narrow.config.ts",
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

  await waitFor(`http://127.0.0.1:${vitePort}/admin-narrow-preview.html`, "Isolated Vite preview", vite);
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
      `http://127.0.0.1:${vitePort}/admin-narrow-preview.html`,
    ],
    { stdio: "ignore" },
  );

  const versionResponse = await waitFor(`http://127.0.0.1:${debugPort}/json/version`, "Headless Chromium", chromium);
  await versionResponse.json();
  const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await targetsResponse.json();
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  assert(pageTarget, "Chromium did not expose a test page.");

  await connectCdp(pageTarget.webSocketDebuggerUrl);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await setViewport(360);
  await checkAdminTabs(360);
  await checkTournamentStates(360);
  assert(browserErrors.length === 0, `Browser errors at 360px: ${browserErrors.join(" | ")}`);
  console.log("PASS 360px — all 11 Admin tabs and tournament creation, room setup, result entry, and completed details.");

  await setViewport(375);
  await checkAdminTabs(375);
  await checkTournamentStates(375);
  assert(browserErrors.length === 0, `Browser errors at 375px: ${browserErrors.join(" | ")}`);
  console.log("PASS 375px — all 11 Admin tabs and tournament creation, room setup, result entry, and completed details.");
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
  if (temporaryProfile) await rm(temporaryProfile, { recursive: true, force: true });
}