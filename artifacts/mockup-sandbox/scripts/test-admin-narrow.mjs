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
const resumeOnly = process.argv.includes("--resume-only");
const homeCarouselOnly = process.argv.includes("--home-carousel-only");
const keyboardFormsOnly = process.argv.includes("--keyboard-forms-only");
const scheduledStartOnly = process.argv.includes("--scheduled-start-only");
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

async function waitForPage(label = "real Admin screen") {
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
  throw new Error(`The ${label} did not render in the isolated preview: ${JSON.stringify(state)}`);
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

async function clickTextLabel(text) {
  const clicked = await evaluate(`(() => {
    const label = [...document.querySelectorAll('*')].find((item) =>
      item.children.length === 0 && item.textContent.trim() === ${JSON.stringify(text)}
    );
    if (!label) return false;
    label.click();
    return true;
  })()`);
  assert(clicked, `Could not find the "${text}" label.`);
  await delay(130);
}

async function assertText(text, label = text) {
  const found = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('body *')];
    return nodes.some((node) =>
      node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(text)}
    );
  })()`);
  if (!found) {
    const body = await evaluate("document.body.innerText.slice(-1000)");
    throw new Error(`Expected ${label} to be visible. Current page text: ${JSON.stringify(body)}`);
  }
}

async function waitForCondition(expression, description) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return;
    await delay(75);
  }
  const state = await evaluate(`(() => ({
    body: document.body.innerText.slice(0, 1200),
    reads: window.__daily007TournamentResume?.getTournamentReadCount?.() ?? null,
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(`${description} did not occur: ${JSON.stringify(state)}`);
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

async function assertAdminRowActionsFit(marker, actions, width, description) {
  const result = await evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const matches = [...document.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim() === marker);
    const markerElement = matches[0];
    if (!markerElement) return null;

    let row = markerElement;
    const hasActions = (element) => {
      const labels = [...element.querySelectorAll('[role="button"], button, [tabindex="0"]')]
        .map((button) => button.textContent.trim().replace(/\\\\s+/g, ' '));
      return ${JSON.stringify(actions)}.every((action) => labels.includes(action));
    };
    while (row && !hasActions(row)) row = row.parentElement;
    if (!row) return { markerFound: true, rowFound: false };

    const rowRect = row.getBoundingClientRect();
    const buttons = [...row.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    const actionRects = ${JSON.stringify(actions)}.map((action) => {
      const button = buttons.find((item) => item.textContent.trim().replace(/\\\\s+/g, ' ') === action);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {
        label: action,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth,
      };
    });
    return {
      markerFound: true,
      rowFound: true,
      row: {
        left: rowRect.left,
        right: rowRect.right,
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      },
      overflowing: [row, ...row.querySelectorAll('*')]
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .slice(0, 6)
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent.trim().slice(0, 140),
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      actions: actionRects,
    };
  })()`);
  assert(result?.markerFound, `${description}: the fake row content is not visible at ${width}px.`);
  assert(result.rowFound, `${description}: the main row actions are missing at ${width}px.`);
  assert(
    result.row.left >= -1 && result.row.right <= width + 1,
    `${description}: the populated row extends beyond the ${width}px viewport.`,
  );
  assert(
    result.row.scrollWidth <= result.row.clientWidth + 2,
    `${description}: row content is clipped horizontally at ${width}px ` +
      `(content ${result.row.scrollWidth}px, box ${result.row.clientWidth}px; ` +
      `overflow: ${JSON.stringify(result.overflowing)}).`,
  );
  for (const action of result.actions) {
    assert(action, `${description}: a main action is missing at ${width}px.`);
    assert(
      action.width > 0 && action.left >= result.row.left - 1 && action.right <= result.row.right + 1,
      `${description}: the "${action.label}" action does not fit inside its row at ${width}px.`,
    );
    assert(
      action.scrollWidth <= action.clientWidth + 2,
      `${description}: the "${action.label}" label is clipped at ${width}px.`,
    );
  }
  const pageWidth = await evaluate("document.documentElement.scrollWidth");
  assert(pageWidth <= width + 1, `The page is horizontally wider than ${width}px on ${description}.`);
}

async function checkPopulatedAdminLists(width) {
  await clickSelector('[data-testid="admin-tab-registrations"]', "Registrations tab");
  await waitForCondition(
    "document.body.innerText.includes('Ananya Daily007 Championship Champion With A Long Name')",
    "the fake pending registration to load",
  );
  await assertAdminRowActionsFit(
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad",
    ["APPROVE", "REJECT"],
    width,
    "Pending registration",
  );

  await clickTextLabel("APPROVED");
  await assertAdminRowActionsFit(
    "Rohan Free Fire Strategist — Preview Approved Team",
    ["DELETE"],
    width,
    "Approved registration",
  );
  await clickTextLabel("REJECTED");
  await assertAdminRowActionsFit(
    "Preview Rejected Player — Preview Rejected Team",
    ["DELETE"],
    width,
    "Rejected registration",
  );

  await clickSelector('[data-testid="admin-tab-payments"]', "Payments tab");
  await waitForCondition(
    "document.body.innerText.includes('Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026')",
    "the fake pending deposit to load",
  );
  await assertAdminRowActionsFit(
    "Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026",
    ["APPROVE", "REJECT"],
    width,
    "Pending deposit",
  );
  await assertAdminRowActionsFit(
    "Rohan International Tournament Champion · User ID: preview-user-rohan-championship-account-2026",
    ["APPROVE", "REJECT", "COPY UPI"],
    width,
    "Pending withdrawal",
  );

  await clickSelector('[data-testid="admin-tab-wallet"]', "Wallet tab");
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake Wallet user to load",
  );
  await assertAdminRowActionsFit(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    ["+ ADD", "− DEDUCT"],
    width,
    "Wallet user",
  );
  await assertText("-987654321 COINS", "the fake Wallet transaction amount");
  await assertAdminRowActionsFit(
    "International Free Fire Grand Finals entry fee refunded to player wallet",
    [],
    width,
    "Wallet transaction",
  );

  await clickSelector('[data-testid="admin-tab-users"]', "Users tab");
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake Admin user to load",
  );
  await assertAdminRowActionsFit(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    ["+ COINS", "− COINS", "BLOCK", "MAKE TOURNAMENT ADMIN"],
    width,
    "Admin user",
  );
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
  await assertText("Preview Player One");
  await assertText("UID TEST-UID-001");
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

async function checkTournamentResume() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "The player tournament screen to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary')",
    "The player list to load its upcoming IST tournament",
  );

  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments are available right now.')",
    "The player Ongoing list to be empty before the scheduled start",
  );

  let readsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.failNextTournamentRead()");
  await evaluate("window.__daily007TournamentResume.startBackgroundCycle()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeResume} && document.body.innerText.includes('Could not refresh tournaments: Temporary network error') && document.body.innerText.includes('IST Start Boundary')`,
    "the failed player refresh to show an error while keeping its loaded card",
  );
  await assertText("IST Start Boundary", "the player tournament after a failed resume refresh");

  await evaluate(
    "window.__daily007TournamentResume.updateTournament({ name: 'Player Refreshed IST Start Boundary' })",
  );
  readsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.startBackgroundCycle()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeResume} && document.body.innerText.includes('Player Refreshed IST Start Boundary')`,
    "a later successful player refresh to update the visible tournament",
  );
  await assertText("Player Refreshed IST Start Boundary", "the updated player tournament");
  const playerRefreshErrorVisible = await evaluate(
    "document.body.innerText.includes('Could not refresh tournaments: Temporary network error')",
  );
  assert(!playerRefreshErrorVisible, "A successful player refresh should clear the earlier refresh error.");
  await evaluate(
    "window.__daily007TournamentResume.updateTournament({ name: 'IST Start Boundary' })",
  );

  await evaluate("window.__daily007TournamentResume.prepareAdmin()");
  await evaluate("window.__daily007TournamentResume.showAdmin()");
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary')",
    "the Admin tournament list to load before its background cycle",
  );
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments.')",
    "the Admin Ongoing list to be empty before the scheduled start",
  );

  readsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.failNextTournamentRead()");
  await evaluate("window.__daily007TournamentResume.startBackgroundCycle()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeResume} && document.body.innerText.includes('Could not refresh tournaments: Temporary network error')`,
    "the failed Admin refresh to show a clear error",
  );
  await assertText("IST Start Boundary", "the Admin tournament after resume");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"admin-tournament-refresh-retry\"]'))",
    "the Admin refresh retry control to appear with the error",
  );

  const visibilityChangesBeforeRetry = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityState() === 'visible'"),
    "The Admin screen must stay visible while retrying its tournament refresh.",
  );
  await evaluate(
    "window.__daily007TournamentResume.failNextTournamentRead('Retry request failed')",
  );
  readsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await clickSelector(
    '[data-testid="admin-tournament-refresh-retry"]',
    "Admin tournament refresh retry",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeResume} && document.body.innerText.includes('Could not refresh tournaments: Retry request failed') && document.body.innerText.includes('IST Start Boundary') && Boolean(document.querySelector('[data-testid="admin-tournament-refresh-retry"]'))`,
    "a failed in-place Admin retry to keep its error and tournament card",
  );
  await assertText("IST Start Boundary", "the Admin tournament after a failed direct retry");
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeRetry,
    "Retrying a failed Admin refresh must not depend on an app background/resume cycle.",
  );

  await evaluate(
    "window.__daily007TournamentResume.updateTournament({ name: 'Updated IST Start Boundary' })",
  );
  readsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await clickSelector(
    '[data-testid="admin-tournament-refresh-retry"]',
    "Admin tournament refresh retry",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeResume} && document.body.innerText.includes('Updated IST Start Boundary')`,
    "a successful in-place Admin retry to update the tournament list",
  );
  await assertText("Updated IST Start Boundary", "the updated Admin tournament");
  const refreshErrorVisible = await evaluate(
    "document.body.innerText.includes('Could not refresh tournaments: Temporary network error') || document.body.innerText.includes('Could not refresh tournaments: Retry request failed')",
  );
  assert(!refreshErrorVisible, "A successful direct Admin retry should clear the earlier refresh error.");
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeRetry,
    "A successful Admin retry must not require an app background/resume cycle.",
  );
}

async function checkTournamentScheduledStart() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the timed-start preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary')",
    "the player list to load its upcoming IST tournament",
  );

  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments are available right now.')",
    "the player Ongoing list to be empty before its scheduled start",
  );
  const visibilityChangesBeforePlayerStart = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityState() === 'visible'"),
    "The player list must stay visible while its scheduled start passes.",
  );
  let tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary')`,
    "the player list timer to move the tournament into Ongoing without app resume",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforePlayerStart,
    "The player start-time transition must not depend on an AppState visibility/resume event.",
  );
  await assertText("IST Start Boundary", "the player tournament after its scheduled start");

  await evaluate("window.__daily007TournamentResume.prepareAdminForScheduledStart()");
  await evaluate("window.__daily007TournamentResume.showAdmin()");
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary')",
    "the Admin list to load its next upcoming IST tournament",
  );
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments.')",
    "the Admin Ongoing list to be empty before its scheduled start",
  );
  const visibilityChangesBeforeAdminStart = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityState() === 'visible'"),
    "The Admin list must stay visible while its scheduled start passes.",
  );
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary')`,
    "the Admin list timer to move the tournament into Ongoing without app resume",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeAdminStart,
    "The Admin start-time transition must not depend on an AppState visibility/resume event.",
  );
  await assertText("IST Start Boundary", "the Admin tournament after its scheduled start");
}

async function checkHomeCarousel() {
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true",
    "Home to initialize",
  );
  await waitForCondition(
    "document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    "Home to show the near-future tournament and two later tournaments",
  );
  await assertText("Starting at IST", "the tournament before its scheduled start");
  await assertText("Later Tournament One");
  await assertText("Later Tournament Two");

  await waitForCondition(
    "window.__daily007HomeCarouselTest.didStartTimerFire() && window.__daily007HomeCarouselTest.getFakeNow() >= window.__daily007HomeCarouselTest.scheduledStartMs && !document.querySelector('[data-testid=\"home-upcoming-card-starting-soon\"]') && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 2",
    "Home to remove the tournament at its scheduled IST start",
  );
  await assertText("Later Tournament One");
  await assertText("Later Tournament Two");

  const carouselState = await evaluate(`(() => {
    const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
    const indicators = document.querySelector('[data-testid="home-upcoming-page-indicators"]');
    if (!carousel || !indicators) return null;
    const remaining = [...carousel.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;
    carousel.scrollLeft = maxScroll;
    carousel.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      remainingIds: remaining.map((item) => item.getAttribute("data-testid")),
      indicatorCount: indicators.children.length,
      maxScroll,
      scrollLeft: carousel.scrollLeft,
    };
  })()`);
  assert(carouselState, "The remaining Home carousel and page indicators should stay mounted.");
  assert(carouselState.remainingIds.length === 2, "Both later tournaments should remain in the carousel.");
  assert(carouselState.indicatorCount === 2, "Page indicators should match the two remaining tournaments.");
  assert(carouselState.maxScroll > 0, "The remaining carousel should still have horizontal content to browse.");
  await waitForCondition(
    "document.querySelector('[data-testid=\"home-upcoming-carousel\"]')?.scrollLeft > 0",
    "The remaining Home carousel to scroll to a later card",
  );

  await clickSelector('[data-testid="home-upcoming-card-later-two"]', "remaining tournament card");
  const navigations = await evaluate("globalThis.__previewNavigations ?? []");
  assert(
    JSON.stringify(navigations.at(-1)) === JSON.stringify(["TDetail", { id: "later-two" }]),
    "The remaining Home tournament card should still open its details.",
  );

  await waitForCondition(
    "window.__daily007HomeCarouselTest.getHomePollCount() === 1 && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === 1",
    "Home to install one bounded registration-aware refresh after the initial load",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.getHomePollIntervalMs() === 30000"),
    "Home should refresh tournament and registration data no more often than its existing 30-second interval.",
  );

  const initialTargetText = await evaluate(
    "document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]')?.innerText ?? ''",
  );
  assert(initialTargetText.includes("JOIN NOW"), "An unregistered Home card should initially offer JOIN NOW.");
  await evaluate(`(() => {
    window.__daily007HomeCarouselTest.unaffectedCardNode =
      document.querySelector('[data-testid="home-upcoming-card-later-two"]');
    return Boolean(window.__daily007HomeCarouselTest.unaffectedCardNode);
  })()`);
  assert(
    await evaluate("Boolean(window.__daily007HomeCarouselTest.unaffectedCardNode)"),
    "The unaffected Home card should be available before registration refreshes.",
  );

  const readsBeforeApproval = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "The Home polling callback should be available.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeApproval.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to show an Admin-approved registration on its next scheduled refresh",
  );
  const readsAfterApproval = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterApproval.tournaments === readsBeforeApproval.tournaments + 1 &&
      readsAfterApproval.registrations === readsBeforeApproval.registrations + 1,
    "One Home poll should issue only one tournament read and one registration read.",
  );

  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "rejected" }
  ])`);
  await evaluate("window.__daily007HomeCarouselTest.failNextTournamentRead('Temporary tournament refresh failure')");
  await evaluate("window.__daily007HomeCarouselTest.deferNextRegistrationRead()");
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "The Home polling callback should remain available.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsAfterApproval.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsAfterApproval.registrations + 1}`,
    "Home to start exactly one tournament and registration read",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]')?.innerText.includes('JOINED')"),
    "A failed tournament refresh must keep the previously displayed joined state.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "The existing Home polling callback should remain available while a request is pending.",
  );
  await delay(120);
  const readsWhilePending = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsWhilePending.tournaments === readsAfterApproval.tournaments + 1 &&
      readsWhilePending.registrations === readsAfterApproval.registrations + 1,
    "A slow registration read must prevent a second Home refresh, even after the tournament request fails.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.releaseRegistrationRead()"),
    "The deferred registration response should be released so the failed poll can settle.",
  );
  await delay(120);
  assert(
    await evaluate("document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]')?.innerText.includes('JOINED')"),
    "The rejected status should not replace cards when its paired tournament refresh fails.",
  );
  const readsBeforeRejectionRefresh = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeRejectionRefresh.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOIN NOW')`,
    "Home to remove the joined label after an Admin rejection is returned successfully",
  );
  const readsAfterRejection = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterRejection.tournaments === readsBeforeRejectionRefresh.tournaments + 1 &&
      readsAfterRejection.registrations === readsBeforeRejectionRefresh.registrations + 1,
    "The recovered Home poll should perform only one read per endpoint.",
  );
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.unaffectedCardNode === document.querySelector('[data-testid="home-upcoming-card-later-two"]')`),
    "Approval and rejection refreshes should not remount an unaffected tournament card.",
  );

  const mergeIdentity = await evaluate(`(() => {
    const changed = { id: "changed", name: "Changed card", joined: false };
    const unchanged = { id: "unchanged", name: "Unaffected card", joined: false };
    const current = [changed, unchanged];
    const incoming = [
      { id: "changed", name: "Changed card" },
      { id: "unchanged", name: "Unaffected card" },
    ];
    const same = window.__daily007HomeCarouselTest.mergeHomeTournamentItems(current, incoming, new Set());
    const approved = window.__daily007HomeCarouselTest.mergeHomeTournamentItems(
      current,
      incoming,
      new Set(["changed"]),
    );
    return {
      sameListReused: same === current,
      changedCardUpdated: approved[0] !== changed && approved[0].joined === true,
      unaffectedCardReused: approved[1] === unchanged,
    };
  })()`);
  assert(mergeIdentity?.sameListReused, "An unchanged refresh should reuse the current Home list.");
  assert(mergeIdentity?.changedCardUpdated, "A joined-status change should update only its tournament card.");
  assert(mergeIdentity?.unaffectedCardReused, "A joined-status change should preserve unaffected card objects.");
}

async function setKeyboardViewport(height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(120);
}

async function setInputValue(selector, value) {
  const updated = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  assert(updated, `Could not enter text into ${selector}.`);
  await delay(90);
}

async function assertKeyboardReachability(scrollTestId, inputTestId, actionTestId, description) {
  const state = await evaluate(`(() => {
    const scrollSelector = ${JSON.stringify(`[data-testid="${scrollTestId}"]`)};
    const inputSelector = ${JSON.stringify(`[data-testid="${inputTestId}"]`)};
    const actionSelector = ${JSON.stringify(`[data-testid="${actionTestId}"]`)};
    const scroll = document.querySelector(scrollSelector);
    const input = document.querySelector(inputSelector);
    const action = document.querySelector(actionSelector);
    if (!scroll || !input || !action) return null;
    input.focus();
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    const scrollRect = scroll.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      inputFocused: document.activeElement === input,
      inputVisible: inputRect.top >= scrollRect.top - 1 && inputRect.bottom <= scrollRect.bottom + 1,
      actionVisible: actionRect.top >= scrollRect.top - 1 && actionRect.bottom <= scrollRect.bottom + 1,
      actionDisabled: action.disabled === true || action.getAttribute("aria-disabled") === "true",
    };
  })()`);
  assert(state, `${description}: the input, scroll area, or primary action is missing.`);
  assert(state.width === 375, `${description}: expected a 375px phone viewport.`);
  assert(state.height <= 360, `${description}: the keyboard-open viewport was not applied.`);
  assert(state.inputFocused, `${description}: the input could not receive focus.`);
  assert(state.inputVisible, `${description}: the focused input is still hidden after scrolling.`);
  assert(state.actionVisible, `${description}: the primary action is still behind the keyboard after scrolling.`);
  assert(!state.actionDisabled, `${description}: the primary action is unexpectedly disabled.`);
  return state;
}

async function assertLayoutRecovered(scrollTestId, minimumClientHeight, description) {
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(720);
  const recovered = await evaluate(`(() => {
    const scroll = document.querySelector(${JSON.stringify(`[data-testid="${scrollTestId}"]`)});
    if (!scroll) return null;
    return {
      height: window.innerHeight,
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      top: scroll.getBoundingClientRect().top,
      bottom: scroll.getBoundingClientRect().bottom,
    };
  })()`);
  assert(recovered, `${description}: the form disappeared after dismissing the keyboard.`);
  assert(recovered.height === 720, `${description}: the full phone viewport did not return.`);
  assert(
    recovered.clientHeight > minimumClientHeight,
    `${description}: the form did not regain its height after dismissing the keyboard ` +
      `(open=${minimumClientHeight}px, restored=${recovered.clientHeight}px, viewport=${recovered.height}px).`,
  );
  return recovered;
}

async function checkWalletAndProfileKeyboard() {
  await waitForCondition(
    "window.__daily007KeyboardForms?.ready === true",
    "Wallet and Edit Profile preview initialization",
  );
  await waitForCondition(
    `(() => {
      const button = document.querySelector('[data-testid="wallet-open-recharge"]');
      return button && button.getAttribute("aria-disabled") !== "true" && !button.disabled;
    })()`,
    "Wallet recharge settings to load",
  );

  await clickSelector('[data-testid="wallet-open-recharge"]', "Wallet recharge action");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="wallet-form-scroll"]') && document.querySelector('[data-testid="payer-upi-id"]'))`,
    "the recharge form to open",
  );
  await setInputValue('[data-testid="wallet-amount"]', "250");
  await setInputValue('[data-testid="payer-upi-id"]', "player@upi");
  await setInputValue('[data-testid="wallet-transaction-id"]', "preview-utr-01");
  await setKeyboardViewport(320);
  const rechargeOpen = await assertKeyboardReachability(
    "wallet-form-scroll",
    "wallet-transaction-id",
    "wallet-recharge-submit",
    "Wallet recharge",
  );
  await assertLayoutRecovered("wallet-form-scroll", rechargeOpen.clientHeight, "Wallet recharge");

  await setKeyboardViewport(320);
  await assertKeyboardReachability(
    "wallet-form-scroll",
    "wallet-transaction-id",
    "wallet-recharge-submit",
    "Wallet recharge submit",
  );
  await clickSelector('[data-testid="wallet-recharge-submit"]', "Wallet recharge submit action");
  await waitForCondition(
    `window.__daily007KeyboardForms.getCalls().some((call) => call.method === "createPayment") && !document.querySelector('[data-testid="wallet-form-scroll"]')`,
    "the recharge request to submit and the sheet to close",
  );
  let calls = await evaluate("window.__daily007KeyboardForms.getCalls()");
  const recharge = calls.find((call) => call.method === "createPayment");
  assert(
    recharge?.payload?.coins === 250 &&
      recharge?.payload?.payerUpiId === "player@upi" &&
      recharge?.payload?.txnId === "preview-utr-01",
    "The keyboard-open recharge action did not submit the entered values.",
  );

  await setKeyboardViewport(720);
  await clickSelector('[data-testid="wallet-open-withdraw"]', "Wallet withdrawal action");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="wallet-form-scroll"]') && document.querySelector('[data-testid="wallet-withdraw-account"]'))`,
    "the withdrawal form to open",
  );
  await setInputValue('[data-testid="wallet-amount"]', "100");
  await setInputValue('[data-testid="wallet-withdraw-account"]', "payout@upi");
  await setKeyboardViewport(320);
  const withdrawOpen = await assertKeyboardReachability(
    "wallet-form-scroll",
    "wallet-withdraw-account",
    "wallet-withdraw-submit",
    "Wallet withdrawal",
  );
  await assertLayoutRecovered("wallet-form-scroll", withdrawOpen.clientHeight, "Wallet withdrawal");

  await setKeyboardViewport(320);
  await assertKeyboardReachability(
    "wallet-form-scroll",
    "wallet-withdraw-account",
    "wallet-withdraw-submit",
    "Wallet withdrawal submit",
  );
  await clickSelector('[data-testid="wallet-withdraw-submit"]', "Wallet withdrawal submit action");
  await waitForCondition(
    `window.__daily007KeyboardForms.getCalls().some((call) => call.method === "withdrawCoins") && !document.querySelector('[data-testid="wallet-form-scroll"]')`,
    "the withdrawal request to submit and the sheet to close",
  );
  calls = await evaluate("window.__daily007KeyboardForms.getCalls()");
  const withdrawal = calls.find((call) => call.method === "withdrawCoins");
  assert(
    withdrawal?.payload?.coins === 100 && withdrawal?.payload?.account === "payout@upi",
    "The keyboard-open withdrawal action did not submit the entered values.",
  );

  await setKeyboardViewport(720);
  await evaluate("window.__daily007KeyboardForms.showProfile()");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="edit-profile-name"]') && document.querySelector('[data-testid="edit-profile-save"]'))`,
    "Edit Profile to render",
  );
  await setInputValue('[data-testid="edit-profile-name"]', "Preview Updated");
  await setInputValue('[data-testid="edit-profile-phone"]', "9876543210");
  await setInputValue('[data-testid="edit-profile-game-uid"]', "1234567890");
  await setKeyboardViewport(320);
  const profileOpen = await assertKeyboardReachability(
    "edit-profile-scroll",
    "edit-profile-game-uid",
    "edit-profile-save",
    "Edit Profile",
  );
  await assertLayoutRecovered("edit-profile-scroll", profileOpen.clientHeight, "Edit Profile");

  await setKeyboardViewport(320);
  await assertKeyboardReachability(
    "edit-profile-scroll",
    "edit-profile-game-uid",
    "edit-profile-save",
    "Edit Profile save",
  );
  await clickSelector('[data-testid="edit-profile-save"]', "Edit Profile save action");
  await waitForCondition(
    `window.__daily007KeyboardForms.getCalls().some((call) => call.method === "updateProfile")`,
    "the profile update to submit",
  );
  calls = await evaluate("window.__daily007KeyboardForms.getCalls()");
  const profile = calls.find((call) => call.method === "updateProfile");
  assert(
    profile?.payload?.name === "Preview Updated" &&
      profile?.payload?.phone === "9876543210" &&
      profile?.payload?.gameUid === "1234567890",
    "The keyboard-open profile action did not submit the entered values.",
  );
  await setKeyboardViewport(720);
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="edit-profile-save"]') && document.querySelector('[data-testid="edit-profile-game-uid"]'))`,
    "Edit Profile layout to remain usable after keyboard dismissal",
  );
}

let vitePort;

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-admin-narrow-"));
  const previewPath = resumeOnly
    ? "tournament-resume-preview.html"
    : scheduledStartOnly
      ? "tournament-resume-preview.html?scheduled-start-only=1"
      : homeCarouselOnly
      ? "home-carousel-preview.html"
      : keyboardFormsOnly
        ? "keyboard-forms-preview.html"
        : "admin-narrow-preview.html";

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
      `http://127.0.0.1:${vitePort}/${previewPath}`,
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
  if (resumeOnly || scheduledStartOnly || homeCarouselOnly || keyboardFormsOnly) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: homeCarouselOnly || scheduledStartOnly ? 390 : keyboardFormsOnly ? 375 : 800,
      height: homeCarouselOnly || scheduledStartOnly ? 844 : keyboardFormsOnly ? 720 : 1000,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForPage(
      homeCarouselOnly
        ? "Home carousel"
        : scheduledStartOnly
          ? "scheduled-start Player and Admin tournament screens"
        : keyboardFormsOnly
          ? "Wallet and Edit Profile"
          : "player and Admin tournament screens",
    );
    if (scheduledStartOnly) {
      await checkTournamentScheduledStart();
      assert(
        browserErrors.length === 0,
        `Browser errors during scheduled-start checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Player and Admin tournament lists move from Upcoming to Ongoing at their IST start while visible, without AppState events.");
    } else if (keyboardFormsOnly) {
      await checkWalletAndProfileKeyboard();
      assert(browserErrors.length === 0, `Browser errors during keyboard form checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Wallet recharge/withdrawal and Edit Profile actions remain reachable at 375px with a simulated keyboard-open viewport.");
    } else if (homeCarouselOnly) {
      await checkHomeCarousel();
      assert(browserErrors.length === 0, `Browser errors during Home carousel checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Home updates joined status after Admin approval/rejection on its 30-second poll, preserves unaffected cards, and keeps the scheduled-start carousel usable.");
    } else {
      await checkTournamentResume();
      assert(browserErrors.length === 0, `Browser errors during tournament resume checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Player refresh recovery works; Admins can retry failed tournament refreshes in place without losing cards.");
    }
  } else {
    await setViewport(320);
    await checkAdminTabs(320);
    await checkPopulatedAdminLists(320);
    await checkTournamentStates(320);
    assert(browserErrors.length === 0, `Browser errors at 320px: ${browserErrors.join(" | ")}`);
    console.log("PASS 320px — all 11 Admin tabs, populated registration/payment/wallet/user rows and actions, and tournament management states.");

    await setViewport(360);
    await checkAdminTabs(360);
    await checkPopulatedAdminLists(360);
    await checkTournamentStates(360);
    assert(browserErrors.length === 0, `Browser errors at 360px: ${browserErrors.join(" | ")}`);
    console.log("PASS 360px — all 11 Admin tabs, populated registration/payment/wallet/user rows and actions, and tournament management states.");

    await setViewport(375);
    await checkAdminTabs(375);
    await checkPopulatedAdminLists(375);
    await checkTournamentStates(375);
    assert(browserErrors.length === 0, `Browser errors at 375px: ${browserErrors.join(" | ")}`);
    console.log("PASS 375px — all 11 Admin tabs, populated registration/payment/wallet/user rows and actions, and tournament management states.");
  }
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