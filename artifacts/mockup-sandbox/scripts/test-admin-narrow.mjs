import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
const minimumAndroidTouchTarget = 48; // CSS pixels equal dp in the 1× Android mobile emulation.
const resumeOnly = process.argv.includes("--resume-only");
const initialLoadFailureOnly = process.argv.includes("--initial-load-failure-only");
const registrationInitialLoadFailureOnly = process.argv.includes("--registration-initial-load-failure-only");
const tournamentDetailRegistrationFailureOnly = process.argv.includes("--tournament-detail-registration-failure-only");
const adminInitialLoadFailureOnly = process.argv.includes("--admin-initial-load-failure-only");
const adminLargeTextInitialLoadFailureOnly = process.argv.includes("--admin-initial-load-failure-large-text-only");
const adminRetryConcurrencyOnly = process.argv.includes("--admin-retry-concurrency-only");
const adminResultEntryRetryOnly = process.argv.includes("--admin-result-entry-retry-only");
const manualRefreshOnly = process.argv.includes("--manual-refresh-only");
const refreshReturnOnly = process.argv.includes("--refresh-return-only");
const refreshCoalescingOnly = process.argv.includes("--refresh-coalescing-only");
const homeCarouselOnly = process.argv.includes("--home-carousel-only");
const singleHomeCardOnly = process.argv.includes("--home-carousel-single-card-only");
const homeStartTransitionOnly = process.argv.includes("--home-start-transition-only");
const homeRetryOnly = process.argv.includes("--home-retry-only");
const homeInitialRetryOnly = process.argv.includes("--home-initial-retry-only");
const homeRefreshOverlapOnly = process.argv.includes("--home-refresh-overlap-only");
const homeQueuedAwayOnly = process.argv.includes("--home-queued-away-only");
const homeDisabledTournamentRefreshOnly = process.argv.includes("--home-disabled-tournament-refresh-only");
const istDateSurfacesOnly = process.argv.includes("--ist-date-surfaces-only");
const manualRefreshLargeTextOnly = process.argv.includes("--manual-refresh-large-text-only");
const keyboardFormsOnly = process.argv.includes("--keyboard-forms-only");
const adminKeyboardFormsOnly = process.argv.includes("--admin-keyboard-forms-only");
const adminNotificationKeyboardOnly = process.argv.includes("--admin-notifications-keyboard-only");
const adminNotificationsAccessibilityOnly = process.argv.includes("--admin-notifications-accessibility-only");
const adminSearchKeyboardOnly = process.argv.includes("--admin-search-keyboard-only");
const adminSearchAccessibilityOnly = process.argv.includes("--admin-search-accessibility-only");
const adminLandscapeKeyboardOnly = process.argv.includes("--admin-landscape-keyboard-only");
const adminLandscapeLargeTextOnly = process.argv.includes("--admin-landscape-large-text-only");
const adminTournamentCreateSaveOnly = process.argv.includes("--admin-tournament-create-save-only");
const adminTournamentEmptyFilterOnly = process.argv.includes("--admin-tournament-empty-filter-only");
const adminTournamentHomeRefreshOnly = process.argv.includes("--admin-tournament-home-refresh-only");
const adminTournamentEditSaveOnly = process.argv.includes("--admin-tournament-edit-save-only");
const scheduledStartOnly = process.argv.includes("--scheduled-start-only");
const sameTimeStartOnly = process.argv.includes("--same-time-start-only");
const adminActionsOnly = process.argv.includes("--admin-actions-only");
const adminLandscapeOnly = process.argv.includes("--admin-landscape-only");
const adminFullAdminRecoveryOnly = process.argv.includes("--admin-full-admin-recovery-only");
const browserErrors = [];
let viteOutput = "";
let messageId = 0;
let chromium;
let vite;
let socket;
let temporaryProfile;
const pending = new Map();
let largeTextScaleScriptRegistered = false;

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
          const stack = message.params.stackTrace?.callFrames
            ?.slice(0, 4)
            .map((frame) => `${frame.url}:${frame.lineNumber + 1}`);
          browserErrors.push(`${text || "Browser console error."}${stack?.length ? ` (${stack.join(" <- ")})` : ""}`);
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

async function setViewport(
  width,
  fontScale = 1,
  previewFile = "admin-narrow-preview.html",
  platform = "android",
) {
  if (!largeTextScaleScriptRegistered) {
    await cdp("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const scale = Number(new URLSearchParams(location.search).get("fontScale"));
        window.__daily007LargeTextScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
      })();`,
    });
    largeTextScaleScriptRegistered = true;
  }
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 820,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const previewUrl = new URL(previewFile, `http://127.0.0.1:${vitePort}/`);
  previewUrl.searchParams.set("run", String(width));
  previewUrl.searchParams.set("fontScale", String(fontScale));
  previewUrl.searchParams.set("platform", platform);
  await cdp("Page.navigate", { url: previewUrl.href });
  await waitForPage();
  await delay(150);
}

async function reloadAdminPreviewForMutationFailureChecks() {
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/admin-narrow-preview.html?run=390&fontScale=1&scenario=mutation-failure-recovery`,
  });
  await waitForPage("fresh isolated Admin preview for mutation failure recovery");
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

async function swipeHomeCarousel(direction, description) {
  const bounds = await evaluate(`(() => {
    const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
    if (!carousel) return null;
    const rect = carousel.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: carousel.clientWidth,
      height: rect.height,
      viewportHeight: window.innerHeight,
    };
  })()`);
  assert(bounds?.width > 0 && bounds.height > 0, `Could not locate the Home carousel for ${description}.`);
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const distance = Math.round(bounds.width * 0.64);
  const startX = Math.round(bounds.left + bounds.width * (direction === "left" ? 0.82 : 0.18));
  const endX = startX + (direction === "left" ? -distance : distance);
  const y = Math.round(
    Math.max(
      bounds.top + 10,
      Math.min(bounds.top + bounds.height / 2, bounds.viewportHeight - 10),
    ),
  );
  const touchPoint = (x) => ({ id: 1, x, y, radiusX: 4, radiusY: 4, force: 1 });
  await cdp("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint(startX)],
  });
  await delay(60);
  await cdp("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touchPoint(endX)],
  });
  await delay(80);
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(300);
}

async function tapSelector(selector, description) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`);
  assert(point, `Could not find a visible touch target for ${description}.`);
  await cdp("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await delay(45);
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(180);
}

async function activateSelector(selector, description, useTouch = false) {
  if (useTouch) await tapSelector(selector, description);
  else await clickSelector(selector, description);
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

async function clickTournamentFormControl(text, description) {
  const prepared = await evaluate(`(() => {
    const form = document.querySelector('[data-testid="admin-tournament-create-form"]');
    if (!form) return false;
    const controls = [...form.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    const control = controls.find((item) => item.textContent.trim() === ${JSON.stringify(text)});
    if (!control) return false;
    control.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  })()`);
  assert(prepared, `Could not find ${description} in the tournament creation form.`);
  await delay(100);
  const clicked = await evaluate(`(() => {
    const form = document.querySelector('[data-testid="admin-tournament-create-form"]');
    if (!form) return false;
    const controls = [...form.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    const control = controls.find((item) => item.textContent.trim() === ${JSON.stringify(text)});
    if (!control) return false;
    const rect = control.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const visible = rect.width > 0 && rect.height > 0 &&
      rect.left >= -1 && rect.right <= window.innerWidth + 1 &&
      rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
    const hitTestable = Boolean(hitTarget && (control === hitTarget || control.contains(hitTarget)));
    if (!visible || !hitTestable) return false;
    control.click();
    return true;
  })()`);
  assert(clicked, `${description} is not visible and tappable in the tournament creation form.`);
  await delay(130);
}

async function clickRowButton(marker, action, description) {
  const clicked = await evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const action = ${JSON.stringify(action)};
    const markerElement = [...document.querySelectorAll('*')].find((element) =>
      element.children.length === 0 && element.textContent.trim() === marker
    );
    if (!markerElement) return false;

    const buttonsIn = (element) => [...element.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    const hasAction = (element) => buttonsIn(element).some((button) => button.textContent.trim() === action);
    let row = markerElement;
    while (row && !hasAction(row)) row = row.parentElement;
    if (!row) return false;
    const button = buttonsIn(row).find((item) => item.textContent.trim() === action);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Could not find the "${action}" action in the ${description} row.`);
  await delay(130);
}

async function clickDialogButton(marker, action, description) {
  const clicked = await evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const action = ${JSON.stringify(action)};
    const markerElement = [...document.querySelectorAll('*')].find((element) =>
      element.children.length === 0 && element.textContent.trim() === marker
    );
    if (!markerElement) return false;

    const buttonsIn = (element) => [...element.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    const hasAction = (element) => buttonsIn(element).some((button) => button.textContent.trim() === action);
    let dialog = markerElement;
    while (dialog && !hasAction(dialog)) dialog = dialog.parentElement;
    if (!dialog) return false;
    const button = buttonsIn(dialog).find((item) => item.textContent.trim() === action);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Could not find the "${action}" action in the ${description}.`);
  await delay(130);
}

async function setLastVisibleInput(value, description) {
  const updated = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')]
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const input = inputs.at(-1);
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert(updated, `Could not enter a value into the ${description}.`);
  await delay(90);
}

async function resetAdminMutationCalls() {
  const reset = await evaluate(`(() => {
    const tracker = window.__daily007AdminMutations;
    if (!tracker?.reset) return false;
    tracker.reset();
    return true;
  })()`);
  assert(reset, "The isolated Admin mutation-call tracker is missing.");
}

async function assertAdminMutation(expected, description) {
  await waitForCondition(
    "window.__daily007AdminMutations?.calls?.length >= 1",
    `${description} API call`,
  );
  const calls = await evaluate("window.__daily007AdminMutations?.calls ?? null");
  assert(Array.isArray(calls) && calls.length === 1, `${description} should make exactly one Admin mutation call: ${JSON.stringify(calls)}.`);
  assert(
    JSON.stringify(calls[0]) === JSON.stringify(expected),
    `${description} targeted the wrong record or operation. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(calls[0])}.`,
  );
}

async function failNextAdminMutation(method, message) {
  const configured = await evaluate(`(() => {
    const tracker = window.__daily007AdminMutations;
    if (!tracker?.failNext) return false;
    tracker.failNext(${JSON.stringify(method)}, ${JSON.stringify(message)});
    return true;
  })()`);
  assert(configured, `Could not configure the isolated ${method} failure.`);
}

async function assertAdminRejectedMutationProbes() {
  await resetAdminMutationCalls();
  const outcomes = await evaluate(
    "window.__daily007AdminMutations?.probeRejectedMutations?.() ?? null",
  );
  const expectedCategories = ["registration", "payment", "wallet", "user status", "user role"];
  assert(
    Array.isArray(outcomes) && outcomes.length === expectedCategories.length,
    `Expected one rejected mutation probe for each category: ${JSON.stringify(outcomes)}.`,
  );
  for (const [index, category] of expectedCategories.entries()) {
    const outcome = outcomes[index];
    assert(
      outcome.category === category && outcome.rejected && outcome.error,
      `The ${category} invalid-input probe should be rejected: ${JSON.stringify(outcome)}.`,
    );
    assert(
      outcome.fixturesUnchanged,
      `The ${category} rejection changed a fake Admin fixture: ${JSON.stringify(outcome)}.`,
    );
    assert(
      !outcome.reportedAsSuccess,
      `The ${category} rejection was recorded as a successful mutation: ${JSON.stringify(outcome)}.`,
    );
  }
  const calls = await evaluate("window.__daily007AdminMutations?.calls ?? null");
  assert(
    Array.isArray(calls) && calls.length === 0,
    `Rejected mutation probes should leave the success log empty: ${JSON.stringify(calls)}.`,
  );
}

async function assertAdminMutationFailure(message, successMessage, description) {
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(message)})`,
    `${description} error`,
  );
  await assertBodyTextAbsent(successMessage, `${description} false success message`);
  const calls = await evaluate("window.__daily007AdminMutations?.calls ?? null");
  assert(
    Array.isArray(calls) && calls.length === 0,
    `${description} should not be recorded as a successful mutation: ${JSON.stringify(calls)}.`,
  );
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

async function assertBodyTextAbsent(text, description = text) {
  const found = await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
  assert(!found, `${description} should no longer be visible.`);
}

async function assertAdminRecordState(marker, { includes = [], excludes = [] } = {}, description = marker) {
  const rowText = await evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const markerElement = [...document.querySelectorAll('*')].find((element) =>
      element.children.length === 0 && element.textContent.trim() === marker
    );
    if (!markerElement) return null;
    const controlsIn = (element) => [...element.querySelectorAll('[role="button"], button, [tabindex="0"]')];
    let row = markerElement;
    while (row && controlsIn(row).length === 0) row = row.parentElement;
    return row?.innerText ?? null;
  })()`);
  assert(typeof rowText === "string", `Could not find the ${description} row in the current Admin view.`);
  for (const text of includes) {
    assert(rowText.includes(text), `${description} should include "${text}". Current row: ${JSON.stringify(rowText)}`);
  }
  for (const text of excludes) {
    assert(!rowText.includes(text), `${description} should not include "${text}". Current row: ${JSON.stringify(rowText)}`);
  }
  return rowText;
}

async function waitForAdminRecordState(marker, state, description = marker) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertAdminRecordState(marker, state, description);
    } catch (error) {
      lastError = error;
      await delay(75);
    }
  }
  throw new Error(`${description} did not refresh: ${lastError?.message || "timed out"}`);
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
    approvedRegistrationRequests: window.__daily007TournamentResume?.getApprovedRegistrationRequests?.() ?? null,
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

async function assertReachableControl(selector, description, { allowDisabled = false } = {}) {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      tagName: element.tagName,
      disabled:
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        getComputedStyle(element).pointerEvents === "none",
      hitTestable: Boolean(hit && (element === hit || element.contains(hit))),
      hitTarget: hit ? hit.tagName + ":" + hit.textContent.trim().slice(0, 50) : null,
      pageWidth: document.documentElement.scrollWidth,
    };
  })()`);
  assert(result, `${description} is missing.`);
  assert(
    result.width > 0 &&
      result.height > 0 &&
      result.left >= -1 &&
      result.right <= result.viewportWidth + 1 &&
      result.top >= -1 &&
      result.bottom <= result.viewportHeight + 1,
    `${description} cannot be brought fully into view at ${result.viewportWidth}×${result.viewportHeight} ` +
      `(bounds=${result.left.toFixed(1)}–${result.right.toFixed(1)} × ` +
      `${result.top.toFixed(1)}–${result.bottom.toFixed(1)}).`,
  );
  assert(
    result.pageWidth <= result.viewportWidth + 1,
    `${description} causes horizontal page overflow at ${result.viewportWidth}px ` +
      `(document=${result.pageWidth}px).`,
  );
  if (!["INPUT", "TEXTAREA"].includes(result.tagName)) {
    assert(
      result.scrollWidth <= result.clientWidth + 2,
      `${description} has horizontally clipped content ` +
        `(content=${result.scrollWidth}px, box=${result.clientWidth}px).`,
    );
  }
  if (!allowDisabled) {
    assert(
      result.hitTestable,
      `${description} is obscured or cannot receive a tap at its center (hit=${result.hitTarget}).`,
    );
  }
  if (!allowDisabled) {
    assert(!result.disabled, `${description} is disabled or does not accept pointer input.`);
  }
}

async function assertAdminTouchTargetGroup(
  selector,
  description,
  width,
  { allowHorizontalScroll = false, expectedCount } = {},
) {
  const targets = await evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label") || element.textContent.trim() ||
        element.getAttribute("placeholder") || element.tagName;
      const disabled =
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        getComputedStyle(element).pointerEvents === "none";
      return {
        testID: element.getAttribute("data-testid"),
        label,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        disabled,
      };
    }))()`);
  assert(targets?.length, `${description} controls are missing at ${width}px.`);
  if (expectedCount !== undefined) {
    assert(
      targets.length === expectedCount,
      `${description} expected ${expectedCount} controls at ${width}px; found ${targets.length}.`,
    );
  }

  for (const target of targets) {
    assert(
      target.width >= minimumAndroidTouchTarget &&
        target.height >= minimumAndroidTouchTarget,
      `${description} "${target.label}" is smaller than the ${minimumAndroidTouchTarget}×${minimumAndroidTouchTarget} Android touch target at ${width}px ` +
        `(actual=${target.width.toFixed(1)}×${target.height.toFixed(1)}).`,
    );
    assert(
      target.scrollWidth <= target.clientWidth + 2 &&
        target.scrollHeight <= target.clientHeight + 2,
      `${description} "${target.label}" has clipped content at ${width}px ` +
        `(content=${target.scrollWidth}×${target.scrollHeight}, box=${target.clientWidth}×${target.clientHeight}).`,
    );
    assert(!target.disabled, `${description} "${target.label}" is disabled at ${width}px.`);
  }

  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex];
      const right = targets[rightIndex];
      const overlaps =
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
      assert(
        !overlaps,
        `${description} controls "${left.label}" and "${right.label}" overlap at ${width}px.`,
      );
    }
  }

  for (const target of targets) {
    if (!allowHorizontalScroll) {
      await assertReachableControl(
        `[data-testid="${target.testID}"]`,
        `${description} "${target.label}"`,
      );
      continue;
    }

    const reachability = await evaluate(`(() => {
      const element = document.querySelector('[data-testid="${target.testID}"]');
      if (!element) return null;
      const scrollPositions = [];
      let scrollNode = element;
      while (scrollNode) {
        scrollPositions.push({
          node: scrollNode,
          left: scrollNode.scrollLeft,
          top: scrollNode.scrollTop,
        });
        scrollNode = scrollNode.parentElement;
      }
      const windowScroll = { left: window.scrollX, top: window.scrollY };
      element.scrollIntoView({ block: "nearest", inline: "center" });
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      let scrollport = element.parentElement;
      while (scrollport && scrollport !== document.body) {
        const style = getComputedStyle(scrollport);
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          scrollport.scrollWidth > scrollport.clientWidth + 1
        ) break;
        scrollport = scrollport.parentElement;
      }
      const result = {
        centerVisible:
          centerX >= -1 && centerX <= window.innerWidth + 1 &&
          centerY >= -1 && centerY <= window.innerHeight + 1,
        hitTestable: Boolean(hit && (element === hit || element.contains(hit))),
        fullyVisible:
          rect.left >= -1 && rect.right <= window.innerWidth + 1 &&
          rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
        scrollable: Boolean(scrollport && scrollport !== document.body),
        pageWidth: document.documentElement.scrollWidth,
      };
      for (const position of scrollPositions) {
        position.node.scrollLeft = position.left;
        position.node.scrollTop = position.top;
      }
      window.scrollTo(windowScroll.left, windowScroll.top);
      return result;
    })()`);
    assert(reachability, `${description} "${target.label}" could not be inspected at ${width}px.`);
    assert(
      reachability.centerVisible && reachability.hitTestable,
      `${description} "${target.label}" cannot receive a tap at its center at ${width}px.`,
    );
    assert(
      reachability.fullyVisible || reachability.scrollable,
      `${description} "${target.label}" is clipped without a horizontal scroll path at ${width}px.`,
    );
    assert(
      reachability.pageWidth <= width + 1,
      `${description} "${target.label}" causes horizontal page overflow at ${width}px.`,
    );
  }
}

async function assertPageHasNoHorizontalOverflow(width, description) {
  const pageWidth = await evaluate(`({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  })`);
  assert(
    pageWidth.document <= width + 1 && pageWidth.body <= width + 1,
    `${description} causes horizontal page overflow at ${width}px ` +
      `(document=${pageWidth.document}px, body=${pageWidth.body}px).`,
  );
}

async function assertVisibleAdminControlsFit(width, description) {
  const result = await evaluate(`(() => {
    const controls = [...document.querySelectorAll('input, textarea, button, [role="button"], [tabindex="0"]')]
      .filter((element) => !element.closest('[data-testid^="admin-tab-"]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent?.trim() ||
            element.getAttribute('placeholder') || element.tagName,
          left: rect.left,
          right: rect.right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      });
    return {
      pageWidth: document.documentElement.scrollWidth,
      controls,
    };
  })()`);
  assert(
    result.pageWidth <= width + 1,
    `${description} causes horizontal page overflow at ${width}px ` +
      `(document=${result.pageWidth}px).`,
  );
  for (const control of result.controls) {
    assert(
      control.left >= -1 && control.right <= width + 1,
      `${description} control "${control.label}" extends outside the ${width}px viewport ` +
        `(${control.left.toFixed(1)}–${control.right.toFixed(1)}px).`,
    );
    assert(
      control.scrollWidth <= control.clientWidth + 2,
      `${description} control "${control.label}" is clipped horizontally at ${width}px ` +
        `(content ${control.scrollWidth}px, box ${control.clientWidth}px).`,
    );
  }
}

async function assertAdminFormControlBounds(width, description) {
  const controls = await evaluate(`(() => {
    const form = document.querySelector('[data-testid="admin-tournament-create-form"]');
    if (!form) return null;
    return [...form.querySelectorAll('input, textarea, button, [role="button"], [tabindex="0"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent?.trim() ||
            element.getAttribute('placeholder') || element.tagName,
          left: rect.left,
          right: rect.right,
        };
      });
  })()`);
  assert(controls, `${description}: the tournament creation form is missing.`);
  for (const control of controls) {
    assert(
      control.left >= -1 && control.right <= width + 1,
      `${description} control "${control.label}" extends outside the ${width}px viewport ` +
        `(${control.left.toFixed(1)}–${control.right.toFixed(1)}px).`,
    );
  }
}

async function assertTournamentStatusTabsFit(width) {
  const result = await evaluate(`(() => {
    const tabs = document.querySelector('[data-testid="admin-tournament-status-tabs"]');
    if (!tabs) return null;
    return [...tabs.querySelectorAll('[data-testid^="admin-tournament-tab-"]')].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {
        label: tab.getAttribute('aria-label') || tab.textContent.trim(),
        selected: getComputedStyle(tab).borderColor === 'rgb(255, 61, 61)',
        left: rect.left,
        right: rect.right,
        clientWidth: tab.clientWidth,
        scrollWidth: tab.scrollWidth,
      };
    });
  })()`);
  assert(result?.length === 3, `Tournament status tabs are missing at ${width}px.`);
  for (const tab of result) {
    assert(
      tab.left >= -1 && tab.right <= width + 1,
      `Tournament tab "${tab.label}" is not fully visible at ${width}px ` +
        `(${tab.left.toFixed(1)}–${tab.right.toFixed(1)}px).`,
    );
    assert(
      tab.scrollWidth <= tab.clientWidth + 2,
      `Tournament tab "${tab.label}" is clipped at ${width}px ` +
        `(content ${tab.scrollWidth}px, box ${tab.clientWidth}px).`,
    );
  }
  assert(
    result.some((tab) => tab.selected),
    `The selected tournament status tab is not exposed at ${width}px.`,
  );
}

async function assertTournamentStatusFilter(status) {
  const expectations = {
    upcoming: {
      statusCounts: { UPCOMING: 1, ONGOING: 0, COMPLETED: 0 },
      actions: [
        "edit-tournament-preview-upcoming",
        "delete-tournament-preview-upcoming",
        "manage-room-preview-upcoming",
      ],
    },
    ongoing: {
      statusCounts: { UPCOMING: 0, ONGOING: 1, COMPLETED: 0 },
      actions: [
        "cancel-tournament-preview-ongoing",
        "manage-room-preview-ongoing",
        "finish-tournament-preview-ongoing",
      ],
    },
    completed: {
      statusCounts: { UPCOMING: 0, ONGOING: 0, COMPLETED: 1 },
      actions: ["completed-result-log-preview-completed"],
    },
  };
  const expected = expectations[status];
  assert(expected, `Unknown tournament lifecycle filter "${status}".`);
  const state = await evaluate(`(() => {
    const pageText = document.body.innerText;
    const filter = document.querySelector('[data-testid="admin-tournament-tab-${status}"]');
    const statusLabels = ["UPCOMING", "ONGOING", "COMPLETED"];
    const actionIds = [
      "edit-tournament-preview-upcoming",
      "delete-tournament-preview-upcoming",
      "manage-room-preview-upcoming",
      "cancel-tournament-preview-ongoing",
      "manage-room-preview-ongoing",
      "finish-tournament-preview-ongoing",
      "completed-result-log-preview-completed",
    ];
    return {
      visibleStatusCounts: Object.fromEntries(
        statusLabels.map((label) => [label, pageText.split(label).length - 1])
      ),
      selectedFilter: Boolean(
        filter && getComputedStyle(filter).borderColor === "rgb(255, 61, 61)",
      ),
      visibleActions: actionIds.filter((id) =>
        Boolean(document.querySelector('[data-testid="' + id + '"]'))
      ),
    };
  })()`);
  assert(
    JSON.stringify(state?.visibleStatusCounts) === JSON.stringify(expected.statusCounts),
    `${status} filter showed the wrong tournament statuses: ${JSON.stringify(state?.visibleStatusCounts)}.`,
  );
  assert(state.selectedFilter, `The ${status} filter is not visibly selected.`);
  assert(
    JSON.stringify(state.visibleActions) === JSON.stringify(expected.actions),
    `${status} filter showed the wrong management actions: ${JSON.stringify(state.visibleActions)}.`,
  );
}

async function assertAdminTournamentEmptyFilter(status) {
  const emptyMessage = `No ${status} tournaments.`;
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(emptyMessage)})`,
    `${status} tournament empty state`,
  );
  const state = await evaluate(`(() => {
    const pageText = document.body.innerText;
    const statusLabels = ["upcoming", "ongoing", "completed"];
    const fixtureNames = [
      "Narrow Preview Upcoming",
      "Narrow Preview Ongoing",
      "Narrow Preview Completed",
    ];
    const actionIds = [
      "edit-tournament-preview-upcoming",
      "delete-tournament-preview-upcoming",
      "manage-room-preview-upcoming",
      "cancel-tournament-preview-ongoing",
      "manage-room-preview-ongoing",
      "finish-tournament-preview-ongoing",
      "completed-result-log-preview-completed",
    ];
    const emptyMessages = statusLabels
      .map((label) => "No " + label + " tournaments.")
      .filter((message) => pageText.includes(message));
    const filter = document.querySelector('[data-testid="admin-tournament-tab-${status}"]');
    return {
      emptyMessages,
      visibleFixtureNames: fixtureNames.filter((name) => pageText.includes(name)),
      visibleActions: actionIds.filter((id) =>
        Boolean(document.querySelector('[data-testid="' + id + '"]'))
      ),
      selectedFilter: Boolean(
        filter && getComputedStyle(filter).borderColor === "rgb(255, 61, 61)",
      ),
    };
  })()`);
  assert(
    JSON.stringify(state.emptyMessages) === JSON.stringify([emptyMessage]),
    `${status} filter should show only "${emptyMessage}": ${JSON.stringify(state.emptyMessages)}.`,
  );
  assert(
    state.visibleFixtureNames.length === 0,
    `${status} empty state retained tournament cards: ${JSON.stringify(state.visibleFixtureNames)}.`,
  );
  assert(
    state.visibleActions.length === 0,
    `${status} empty state retained management actions: ${JSON.stringify(state.visibleActions)}.`,
  );
  assert(state.selectedFilter, `The ${status} filter is not visibly selected.`);
}

async function checkAdminTournamentEmptyFilters() {
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tab-tournaments"]'))`,
    "Admin navigation",
  );
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments Admin tab");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="edit-tournament-preview-upcoming"]')) &&
      document.body.innerText.includes("Narrow Preview Upcoming")`,
    "the sole upcoming tournament fixture",
  );
  const populatedState = await evaluate(`(() => {
    const pageText = document.body.innerText;
    const actions = [
      "edit-tournament-preview-upcoming",
      "delete-tournament-preview-upcoming",
      "manage-room-preview-upcoming",
      "cancel-tournament-preview-ongoing",
      "manage-room-preview-ongoing",
      "finish-tournament-preview-ongoing",
      "completed-result-log-preview-completed",
    ];
    return {
      emptyMessages: ["upcoming", "ongoing", "completed"]
        .map((status) => "No " + status + " tournaments.")
        .filter((message) => pageText.includes(message)),
      visibleActions: actions.filter((id) =>
        Boolean(document.querySelector('[data-testid="' + id + '"]'))
      ),
      staleFixtureNames: [
        "Narrow Preview Ongoing",
        "Narrow Preview Completed",
      ].filter((name) => pageText.includes(name)),
    };
  })()`);
  assert(
    populatedState.emptyMessages.length === 0 &&
      populatedState.visibleActions.join(",") ===
        "edit-tournament-preview-upcoming,delete-tournament-preview-upcoming,manage-room-preview-upcoming" &&
      populatedState.staleFixtureNames.length === 0,
    `The populated Upcoming filter did not show only its own tournament and actions: ${JSON.stringify(populatedState)}.`,
  );

  for (const status of ["ongoing", "completed"]) {
    await clickSelector(
      `[data-testid="admin-tournament-tab-${status}"]`,
      `${status} tournament filter`,
    );
    await assertAdminTournamentEmptyFilter(status);
  }

  await clickSelector(
    '[data-testid="admin-tournament-tab-upcoming"]',
    "Upcoming tournament filter",
  );
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="edit-tournament-preview-upcoming"]')) &&
      document.body.innerText.includes("Narrow Preview Upcoming")`,
    "the populated Upcoming tournament to return",
  );
  const returnedState = await evaluate(`(() => {
    const pageText = document.body.innerText;
    const actions = [
      "edit-tournament-preview-upcoming",
      "delete-tournament-preview-upcoming",
      "manage-room-preview-upcoming",
    ];
    return {
      emptyMessages: ["upcoming", "ongoing", "completed"]
        .map((status) => "No " + status + " tournaments.")
        .filter((message) => pageText.includes(message)),
      visibleActions: actions.filter((id) =>
        Boolean(document.querySelector('[data-testid="' + id + '"]'))
      ),
    };
  })()`);
  assert(
    returnedState.emptyMessages.length === 0 &&
      returnedState.visibleActions.join(",") ===
        "edit-tournament-preview-upcoming,delete-tournament-preview-upcoming,manage-room-preview-upcoming",
    `Returning to Upcoming did not restore its tournament and actions: ${JSON.stringify(returnedState)}.`,
  );
}

async function assertVisibleTextFits(selector, width, description) {
  const overflowing = await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return null;
    return [...root.querySelectorAll('*')]
      .filter((element) =>
        element.children.length === 0 &&
        element.textContent?.trim() &&
        element.clientWidth > 0
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.textContent.trim().slice(0, 90),
          left: rect.left,
          right: rect.right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      })
      .filter((element) =>
        element.right > element.left &&
        (element.left < -1 || element.right > ${width} + 1 || element.scrollWidth > element.clientWidth + 2)
      );
  })()`);
  assert(
    overflowing?.length === 0,
    `${description} has clipped or out-of-bounds text at ${width}px: ` +
      `${JSON.stringify(overflowing?.slice(0, 5) ?? "the content panel is missing")}.`,
  );
}

async function openAdminTab(key, label, { requireReachability = false } = {}) {
  const selector = `[data-testid="admin-tab-${key}"]`;
  if (requireReachability) {
    await assertReachableControl(selector, `${label} Admin tab`);
  }
  await activateSelector(selector, `${label} tab`, requireReachability);
}

async function checkAdminTabs(width, { requireReachability = false } = {}) {
  const initial = await evaluate(`(() => {
    const item = document.querySelector('[data-testid="admin-tab-dashboard"]');
    if (!item) return null;
    const style = getComputedStyle(item);
    return { background: style.backgroundColor, border: style.borderColor };
  })()`);
  assert(initial, `The Dashboard tab selector is missing at ${width}px.`);

  for (const [key, label] of adminTabs) {
    await openAdminTab(key, label, { requireReachability });
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
        touchWidth: itemRect.width,
        touchHeight: itemRect.height,
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
    assert(
      selected.touchWidth >= minimumAndroidTouchTarget &&
        selected.touchHeight >= minimumAndroidTouchTarget,
      `${label} Admin tab is smaller than the ${minimumAndroidTouchTarget}×${minimumAndroidTouchTarget} Android touch target at ${width}px ` +
        `(actual=${selected.touchWidth.toFixed(1)}×${selected.touchHeight.toFixed(1)}).`,
    );
    assert(selected.itemVisible, `${label} is not scrolled into view at ${width}px.`);
    assert(selected.bodyWidth <= width + 1, `The page is horizontally wider than ${width}px on the ${label} tab.`);
  }
}

async function assertAdminRowActionsFit(
  marker,
  actions,
  width,
  description,
  { requireReachability = false } = {},
) {
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
      let scrollParent = button.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        const overflowY = getComputedStyle(scrollParent).overflowY;
        if (
          scrollParent.scrollHeight > scrollParent.clientHeight + 2 &&
          (overflowY === "auto" || overflowY === "scroll")
        ) break;
        scrollParent = scrollParent.parentElement;
      }
      const scrollTarget = scrollParent ?? document.scrollingElement;
      if (scrollTarget && scrollTarget.scrollHeight > scrollTarget.clientHeight + 2) {
        const buttonRect = button.getBoundingClientRect();
        const scrollRectTop = scrollParent ? scrollParent.getBoundingClientRect().top : 0;
        const desiredScrollTop =
          scrollTarget.scrollTop +
          buttonRect.top -
          scrollRectTop -
          (scrollTarget.clientHeight - buttonRect.height) / 2;
        scrollTarget.scrollTop = Math.max(
          0,
          Math.min(scrollTarget.scrollHeight - scrollTarget.clientHeight, desiredScrollTop),
        );
      }
      const rect = button.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: action,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth,
        clientHeight: button.clientHeight,
        scrollHeight: button.scrollHeight,
        enabled:
          button.disabled !== true &&
          button.getAttribute("aria-disabled") !== "true" &&
          getComputedStyle(button).pointerEvents !== "none",
        hitTestable: Boolean(hitTarget && (button === hitTarget || button.contains(hitTarget))),
        hitTarget: hitTarget
          ? hitTarget.tagName + ":" + hitTarget.textContent.trim().slice(0, 40)
          : null,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    return {
      markerFound: true,
      rowFound: true,
      row: {
        left: rowRect.left,
        right: rowRect.right,
        height: rowRect.height,
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        pageWidth: document.documentElement.scrollWidth,
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
    `${description}: the populated row extends beyond the ${width}px viewport ` +
      `(bounds=${result.row.left.toFixed(1)}–${result.row.right.toFixed(1)}, ` +
      `page=${result.row.pageWidth}px, box=${result.row.clientWidth}px, content=${result.row.scrollWidth}px).`,
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
    assert(
      action.width >= minimumAndroidTouchTarget &&
        action.height >= minimumAndroidTouchTarget,
      `${description}: the "${action.label}" action is smaller than the ` +
        `${minimumAndroidTouchTarget}×${minimumAndroidTouchTarget} Android touch target at ${width}px ` +
        `(actual=${action.width.toFixed(1)}×${action.height.toFixed(1)}).`,
    );
    assert(
      action.height > 0 &&
        action.scrollHeight <= action.clientHeight + 2 &&
        action.enabled &&
        action.hitTestable,
      `${description}: the "${action.label}" action is clipped, disabled, or obscured at ${width}px ` +
        `(height=${action.height}, content=${action.scrollHeight}/${action.clientHeight}, ` +
        `enabled=${action.enabled}, hit-testable=${action.hitTestable}, ` +
        `bounds=${action.top}-${action.bottom}/${action.viewportHeight}, hit=${action.hitTarget}).`,
    );
    if (requireReachability) {
      assert(
        action.top >= -1 && action.bottom <= action.viewportHeight + 1,
        `${description}: the "${action.label}" action cannot be fully brought into the ` +
          `${action.viewportHeight}px landscape viewport ` +
          `(bounds=${action.top.toFixed(1)}–${action.bottom.toFixed(1)}px).`,
      );
    }
  }
  if (
    ["Wallet user", "Admin user"].includes(description) &&
    await evaluate("window.__daily007LargeTextScale === 1.5")
  ) {
    assert(
      result.row.height < 1000,
      `${description}: the populated card became excessively tall at ${width}px (${result.row.height}px).`,
    );
  }
  const pageWidth = await evaluate("document.documentElement.scrollWidth");
  assert(pageWidth <= width + 1, `The page is horizontally wider than ${width}px on ${description}.`);
}

async function checkPopulatedAdminLists(width, { requireReachability = false } = {}) {
  await assertAdminTouchTargetGroup(
    '[data-testid="admin-refresh-control"], [data-testid="admin-header-logout-control"]',
    "Admin header controls",
    width,
    { expectedCount: 2 },
  );
  await assertAdminTouchTargetGroup(
    '[data-testid="admin-account-logout-control"]',
    "Admin account logout control",
    width,
    { expectedCount: 1 },
  );

  await openAdminTab("registrations", "Registrations", { requireReachability });
  await waitForCondition(
    "document.body.innerText.includes('Ananya Daily007 Championship Champion With A Long Name')",
    "the fake pending registration to load",
  );
  await assertAdminTouchTargetGroup(
    '[data-testid^="admin-registration-filter-"]',
    "Registration status filters",
    width,
    { expectedCount: 3 },
  );
  await assertAdminTouchTargetGroup(
    '[data-testid^="admin-registration-tournament-filter-"]',
    "Registration tournament filters",
    width,
    { allowHorizontalScroll: true, expectedCount: 2 },
  );
  await assertAdminTouchTargetGroup(
    '[data-testid^="admin-registration-export-tournament-"]',
    "Registration export tournament filters",
    width,
    { allowHorizontalScroll: true, expectedCount: 1 },
  );
  await assertAdminRowActionsFit(
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad",
    ["APPROVE", "REJECT"],
    width,
    "Pending registration",
    { requireReachability },
  );

  await assertReachableControl(
    '[data-testid="admin-registration-filter-approved"]',
    "Approved registration filter",
  );
  await tapSelector('[data-testid="admin-registration-filter-approved"]', "Approved registration filter");
  await waitForCondition(
    "document.body.innerText.includes('Rohan Free Fire Strategist — Preview Approved Team')",
    "approved registration to appear after selecting its filter",
  );
  await assertAdminRowActionsFit(
    "Rohan Free Fire Strategist — Preview Approved Team",
    ["DELETE"],
    width,
    "Approved registration",
    { requireReachability },
  );
  await assertReachableControl(
    '[data-testid="admin-registration-filter-rejected"]',
    "Rejected registration filter",
  );
  await tapSelector('[data-testid="admin-registration-filter-rejected"]', "Rejected registration filter");
  await waitForCondition(
    "document.body.innerText.includes('Preview Rejected Player — Preview Rejected Team')",
    "rejected registration to appear after selecting its filter",
  );
  await assertAdminRowActionsFit(
    "Preview Rejected Player — Preview Rejected Team",
    ["DELETE"],
    width,
    "Rejected registration",
    { requireReachability },
  );

  await openAdminTab("payments", "Payments", { requireReachability });
  await waitForCondition(
    "document.body.innerText.includes('Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026')",
    "the fake pending deposit to load",
  );
  await assertAdminTouchTargetGroup(
    '[data-testid^="admin-payment-filter-"]',
    "Payment status filters",
    width,
    { expectedCount: 3 },
  );
  await assertReachableControl('[data-testid="admin-payment-filter-approved"]', "Approved payment filter");
  await tapSelector('[data-testid="admin-payment-filter-approved"]', "Approved payment filter");
  await waitForCondition(
    "document.body.innerText.includes('Approved Preview Payout Player · User ID: preview-user-approved-payout-2026')",
    "approved payment to appear after selecting its filter",
  );
  await assertReachableControl('[data-testid="admin-payment-filter-pending"]', "Pending payment filter");
  await tapSelector('[data-testid="admin-payment-filter-pending"]', "Pending payment filter");
  await waitForCondition(
    "document.body.innerText.includes('Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026')",
    "pending payment to reappear after selecting its filter",
  );
  await assertAdminRowActionsFit(
    "Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026",
    ["APPROVE", "REJECT"],
    width,
    "Pending deposit",
    { requireReachability },
  );
  await assertAdminRowActionsFit(
    "Rohan International Tournament Champion · User ID: preview-user-rohan-championship-account-2026",
    ["APPROVE", "REJECT", "COPY UPI"],
    width,
    "Pending withdrawal",
    { requireReachability },
  );

  await openAdminTab("wallet", "Wallet", { requireReachability });
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake Wallet user to load",
  );
  await assertAdminTouchTargetGroup(
    '[data-testid="admin-wallet-user-search"]',
    "Wallet user search filter",
    width,
    { expectedCount: 1 },
  );
  await assertAdminRowActionsFit(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    ["+ ADD", "− DEDUCT"],
    width,
    "Wallet user",
    { requireReachability },
  );
  await assertText("-987654321 COINS", "the fake Wallet transaction amount");
  await assertAdminRowActionsFit(
    "International Free Fire Grand Finals entry fee refunded to player wallet",
    [],
    width,
    "Wallet transaction",
    { requireReachability },
  );

  await openAdminTab("users", "Users", { requireReachability });
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake Admin user to load",
  );
  await assertAdminRowActionsFit(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    ["+ COINS", "− COINS", "BLOCK", "MAKE TOURNAMENT ADMIN"],
    width,
    "Admin user",
    { requireReachability },
  );
}

async function assertNotificationTypesFit(width) {
  const state = await evaluate(`(() => [...document.querySelectorAll('[data-testid^="notification-type-"]')].map((control) => {
    const rect = control.getBoundingClientRect();
    const text = [...control.querySelectorAll('*')].find((element) =>
      element.children.length === 0 && element.textContent.trim()
    );
    const textRect = text?.getBoundingClientRect();
    return {
      label: control.textContent.trim(),
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      textLeft: textRect?.left ?? null,
      textRight: textRect?.right ?? null,
      textClientWidth: text?.clientWidth ?? 0,
      textScrollWidth: text?.scrollWidth ?? 0,
    };
  }))()`);
  assert(state?.length === 6, `All six notification audience labels should render at ${width}px.`);
  for (const control of state) {
    assert(
      control.width > 0 &&
        control.left >= -1 &&
        control.right <= width + 1,
      `Notification audience "${control.label}" is outside the ${width}px viewport.`,
    );
    assert(
      control.textLeft >= control.left - 1 &&
        control.textRight <= control.right + 1 &&
        control.textScrollWidth <= control.textClientWidth + 2,
      `Notification audience "${control.label}" is clipped at ${width}px.`,
    );
  }
  await assertPageHasNoHorizontalOverflow(width, "Notification audience labels");
}

async function checkRemainingAdminListsAtLargeText(width) {
  await openAdminTab("videos", "Videos");
  await waitForCondition(
    "document.body.innerText.includes('Daily007 Guide: Joining the International Free Fire Championship')",
    "the fake managed videos to load",
  );
  for (const video of [
    {
      id: "preview-admin-video-active-international-guide",
      title: "Daily007 Guide: Joining the International Free Fire Championship",
      actions: ["EDIT", "HIDE", "DELETE"],
      status: "ACTIVE",
      description: "Active managed video",
    },
    {
      id: "preview-admin-video-hidden-prize-guide",
      title: "How to Review Match Results and Claim Your Championship Prize",
      actions: ["EDIT", "ACTIVATE", "DELETE"],
      status: "HIDDEN",
      description: "Hidden managed video",
    },
  ]) {
    await assertHorizontalFit(
      `[data-testid="admin-video-title-${video.id}"]`,
      `${video.description} title`,
      width,
    );
    await assertHorizontalFit(
      `[data-testid="admin-video-topic-${video.id}"]`,
      `${video.description} topic`,
      width,
    );
    await assertHorizontalFit(
      `[data-testid="admin-video-status-${video.id}"]`,
      `${video.description} status`,
      width,
    );
    await assertAdminRowActionsFit(
      video.title,
      video.actions,
      width,
      video.description,
      { requireReachability: true },
    );
  }
  await assertPageHasNoHorizontalOverflow(width, "Managed video list");

  await openAdminTab("earnTasks", "Earn");
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake YouTube task claims to load",
  );
  for (const claim of [
    {
      userName: "Ananya Daily007 Championship Champion With A Long Name",
      description: "First pending YouTube task claim",
    },
    {
      userName: "Rohan Free Fire Strategist and National Tournament Finalist",
      description: "Second pending YouTube task claim",
    },
  ]) {
    await assertAdminRowActionsFit(
      claim.userName,
      ["APPROVE & CREDIT", "REJECT"],
      width,
      claim.description,
      { requireReachability: true },
    );
  }
  await assertPageHasNoHorizontalOverflow(width, "YouTube task claim list");

  await openAdminTab("notifications", "Notifications");
  await assertNotificationTypesFit(width);
  await clickSelector(
    '[data-testid="notification-type-selected"]',
    "Select Users notification audience",
  );
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the fake notification recipients to load",
  );
  for (const recipient of [
    {
      id: "preview-user-ananya-championship-2026",
      email: "ananya.champion.with.a.long.fake.address@example.invalid",
    },
    {
      id: "preview-user-rohan-free-fire-2026",
      email: "rohan.preview.player@example.invalid",
    },
    {
      id: "preview-notification-recipient-meera-2026",
      email: "meera.international.championship.preview@example.invalid",
    },
    {
      id: "preview-notification-recipient-kabir-2026",
      email: "kabir.national.tournament.finalist.preview@example.invalid",
    },
  ]) {
    const selector = `[data-testid="notification-recipient-${recipient.id}"]`;
    await assertVisibleTextFits(
      selector,
      width,
      `Notification recipient ${recipient.email}`,
    );
    await assertReachableControl(
      selector,
      `Notification recipient ${recipient.email}`,
    );
  }
  await clickSelector(
    '[data-testid="notification-recipient-preview-user-ananya-championship-2026"]',
    "Select the first preview notification recipient",
  );

  await setTournamentFormValue(
    '[data-testid="admin-notification-title"]',
    "Daily007 Championship Update",
  );
  await setTournamentFormValue(
    '[data-testid="admin-notification-body"]',
    "Room details for the international championship are ready. Open My Matches before the scheduled start.",
  );
  await assertReachableControl(
    '[data-testid="admin-notification-send"]',
    "Send notification action",
  );
  await resetAdminMutationCalls();
  await clickSelector(
    '[data-testid="admin-notification-send"]',
    "Send notification action",
  );
  await assertAdminMutation({
    method: "adminSendNotification",
    payload: {
      title: "Daily007 Championship Update",
      body: "Room details for the international championship are ready. Open My Matches before the scheduled start.",
      type: "selected",
      userIds: ["preview-user-ananya-championship-2026"],
    },
  }, "Selected-recipient notification");
  await assertPageHasNoHorizontalOverflow(width, "Selected-recipient notification");
}

function assertNotificationKeyboardTapPolicyIsPassedThrough() {
  const notificationScreen = readFileSync(
    path.join(workspaceRoot, "artifacts/daily007/src/screens/AdminNotifications.tsx"),
    "utf8",
  );
  const adminKit = readFileSync(
    path.join(workspaceRoot, "artifacts/daily007/src/components/adminKit.tsx"),
    "utf8",
  );
  assert(
    /<ScreenWrap keyboardShouldPersistTaps="handled">/.test(notificationScreen),
    "The Notifications screen must let its Send button handle the first tap while the Android keyboard is open.",
  );
  assert(
    /keyboardShouldPersistTaps=\{keyboardShouldPersistTaps\}/.test(adminKit),
    "ScreenWrap must pass the notification keyboard tap policy to its native ScrollView.",
  );
}

async function assertNotificationInputFocusedAndVisible(
  selector,
  expectedValue,
  width,
  keyboardHeight,
  description,
) {
  const state = await evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field) return null;
    const rect = field.getBoundingClientRect();
    return {
      active: document.activeElement === field,
      value: field.value,
      width: window.innerWidth,
      height: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  })()`);
  assert(state, `${description}: the focused field is missing.`);
  assert(
    state.active && state.value === expectedValue,
    `${description}: the field lost focus or its entered value: ${JSON.stringify(state)}.`,
  );
  assert(
    state.width === width && state.height === keyboardHeight,
    `${description}: the Android keyboard viewport changed unexpectedly: ${JSON.stringify(state)}.`,
  );
  assert(
    state.left >= -1 &&
      state.right <= width + 1 &&
      state.top >= -1 &&
      state.bottom <= keyboardHeight + 1,
    `${description}: the focused field is not fully visible above the keyboard: ${JSON.stringify(state)}.`,
  );
}

async function bringNotificationSendActionIntoView(width, keyboardHeight, description) {
  await evaluate(`(() => {
    const action = document.querySelector('[data-testid="admin-notification-send"]');
    if (!action) return null;
    let scrollable = null;
    for (let parent = action.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (
        /(auto|scroll)/.test(style.overflowY + " " + style.overflow) &&
        parent.scrollHeight > parent.clientHeight + 2
      ) {
        scrollable = parent;
        break;
      }
    }
    const actionRect = action.getBoundingClientRect();
    if (scrollable) {
      const scrollRect = scrollable.getBoundingClientRect();
      const visibleTop = Math.max(0, scrollRect.top);
      const visibleBottom = Math.min(window.innerHeight, scrollRect.bottom);
      if (actionRect.bottom > visibleBottom) {
        scrollable.scrollTop += actionRect.bottom - visibleBottom + 4;
      } else if (actionRect.top < visibleTop) {
        scrollable.scrollTop -= visibleTop - actionRect.top + 4;
      }
    } else if (actionRect.bottom > window.innerHeight) {
      window.scrollBy(0, actionRect.bottom - window.innerHeight + 4);
    } else if (actionRect.top < 0) {
      window.scrollBy(0, actionRect.top - 4);
    }
    return true;
  })()`);
  await delay(90);
  const state = await evaluate(`(() => {
    const action = document.querySelector('[data-testid="admin-notification-send"]');
    if (!action) return null;
    let scrollable = null;
    for (let parent = action.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (
        /(auto|scroll)/.test(style.overflowY + " " + style.overflow) &&
        parent.scrollHeight > parent.clientHeight + 2
      ) {
        scrollable = parent;
        break;
      }
    }
    const rect = action.getBoundingClientRect();
    const scrollRect = scrollable?.getBoundingClientRect();
    const visibleTop = Math.max(0, scrollRect?.top ?? 0);
    const visibleBottom = Math.min(window.innerHeight, scrollRect?.bottom ?? window.innerHeight);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      visibleTop,
      visibleBottom,
      disabled:
        action.disabled === true ||
        action.getAttribute("aria-disabled") === "true" ||
        getComputedStyle(action).pointerEvents === "none",
      hitTestable: Boolean(hit && (action === hit || action.contains(hit))),
      scrollable: Boolean(scrollable),
      scrollTop: scrollable?.scrollTop ?? window.scrollY,
      scrollHeight: scrollable?.scrollHeight ?? document.documentElement.scrollHeight,
      clientHeight: scrollable?.clientHeight ?? window.innerHeight,
    };
  })()`);
  assert(state, `${description}: the Send Notification action is missing.`);
  assert(
    state.width === width && state.height === keyboardHeight,
    `${description}: the reduced Android viewport was not retained: ${JSON.stringify(state)}.`,
  );
  assert(
    state.left >= -1 &&
      state.right <= width + 1 &&
      state.top >= state.visibleTop - 1 &&
      state.bottom <= state.visibleBottom + 1 &&
      state.top >= -1 &&
      state.bottom <= keyboardHeight + 1,
    `${description}: Send Notification could not be brought fully above the keyboard: ${JSON.stringify(state)}.`,
  );
  assert(!state.disabled, `${description}: Send Notification is disabled.`);
  assert(state.hitTestable, `${description}: Send Notification is covered and cannot be tapped.`);
  assert(
    state.scrollable && state.scrollTop > 0 && state.scrollHeight > state.clientHeight,
    `${description}: the notification form did not scroll within its available keyboard viewport: ${JSON.stringify(state)}.`,
  );
  return {
    x: (state.left + state.right) / 2,
    y: (state.top + state.bottom) / 2,
  };
}

async function checkAdminNotificationsKeyboardAcrossWidths() {
  const widths = [320, 360, 375, 390, 412, 430];
  const keyboardHeight = 420;
  const recipientId = "preview-user-ananya-championship-2026";
  const recipientSelector = `[data-testid="notification-recipient-${recipientId}"]`;
  const titleSelector = '[data-testid="admin-notification-title"]';
  const bodySelector = '[data-testid="admin-notification-body"]';

  assertNotificationKeyboardTapPolicyIsPassedThrough();
  for (const width of widths) {
    await setViewport(width, 1.5);
    assert(
      await evaluate(
        `window.innerWidth === ${width} && window.__daily007LargeTextScale === 1.5`,
      ),
      `The Admin notification preview did not apply ${width}px and 1.5× Android text.`,
    );
    await openAdminTab("notifications", "Notifications");
    await assertNotificationTypesFit(width);
    await clickSelector(
      '[data-testid="notification-type-selected"]',
      `Select Users notification audience at ${width}px`,
    );
    await waitForCondition(
      `document.querySelector(${JSON.stringify(recipientSelector)}) !== null`,
      `fake notification recipients at ${width}px`,
    );
    await clickSelector(recipientSelector, `Select the isolated fake recipient at ${width}px`);
    await waitForCondition(
      `document.body.innerText.includes("RECIPIENTS · 1 selected")`,
      `one selected fake recipient at ${width}px`,
    );

    await openAdminKeyboardViewport(keyboardHeight, width);
    assert(
      await evaluate(
        `window.innerWidth === ${width} && window.innerHeight === ${keyboardHeight}`,
      ),
      `The ${width}px preview did not resize for the simulated Android keyboard.`,
    );
    await assertPageHasNoHorizontalOverflow(width, `Notification form with keyboard open at ${width}px`);

    const title = `Preview update ${width}`;
    const message = `Isolated notification message for ${width}px; no real users are contacted.`;
    await setTournamentFormValue(titleSelector, title);
    await assertNotificationInputFocusedAndVisible(
      titleSelector,
      title,
      width,
      keyboardHeight,
      `Notification title at ${width}px`,
    );
    await setTournamentFormValue(bodySelector, message);
    await assertNotificationInputFocusedAndVisible(
      bodySelector,
      message,
      width,
      keyboardHeight,
      `Notification message at ${width}px`,
    );
    assert(
      await evaluate(`document.body.innerText.includes("RECIPIENTS · 1 selected")`),
      `The selected notification recipient was lost while entering text at ${width}px.`,
    );

    const tapPoint = await bringNotificationSendActionIntoView(
      width,
      keyboardHeight,
      `Notification Send action at ${width}px`,
    );
    await assertPageHasNoHorizontalOverflow(width, `Notification send action at ${width}px`);
    await resetAdminMutationCalls();
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: tapPoint.x,
      y: tapPoint.y,
      button: "left",
      clickCount: 1,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: tapPoint.x,
      y: tapPoint.y,
      button: "left",
      clickCount: 1,
    });
    await assertAdminMutation(
      {
        method: "adminSendNotification",
        payload: {
          title,
          body: message,
          type: "selected",
          userIds: [recipientId],
        },
      },
      `Fake selected-recipient notification at ${width}px`,
    );
    assert(
      await evaluate(`window.innerHeight === ${keyboardHeight}`),
      `Sending at ${width}px unexpectedly restored the full viewport before the keyboard was dismissed.`,
    );
    await assertPageHasNoHorizontalOverflow(width, `Sent notification at ${width}px`);
    console.log(
      `PASS ${width}px at 1.5× text with a simulated Android keyboard — both fields remain focused and visible, the fake recipient stays selected, and Send Notification can be scrolled fully into view and tapped.`,
    );
  }
}

async function assertAdminSearchField(
  testId,
  value,
  width,
  description,
  { requireViewportVisibility = false } = {},
) {
  const field = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="${testId}"]');
    if (!(input instanceof HTMLInputElement)) return null;
    const rect = input.getBoundingClientRect();
    return {
      value: input.value,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
      focused: document.activeElement === input,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      scrollLeft: input.scrollLeft,
      clientWidth: input.clientWidth,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  })()`);
  assert(field, `${description}: the search field is missing at ${width}px.`);
  assert(
    field.value === value,
    `${description}: the full search value was not retained at ${width}px.`,
  );
  assert(
    field.left >= -1 && field.right <= width + 1 && field.width > 0 && field.height >= 44,
    `${description}: the search field is clipped or too small to reach at ${width}px ` +
      `(${field.left}–${field.right}px, ${field.width}×${field.height}px).`,
  );
  assert(
    field.fontSize >= 25,
    `${description}: the search text is not shown at the simulated 1.5× size ` +
      `(${field.fontSize}px at ${width}px).`,
  );
  assert(
    field.focused &&
      field.selectionStart === value.length &&
      field.selectionEnd === value.length &&
      field.scrollLeft > 0,
    `${description}: the focused search field cannot reach the end of the long value at ${width}px ` +
      `(selection ${field.selectionStart}–${field.selectionEnd}/${value.length}, ` +
      `scrollLeft=${field.scrollLeft}, width=${field.clientWidth}px).`,
  );
  await assertPageHasNoHorizontalOverflow(width, description);
  if (requireViewportVisibility) {
    assert(
      field.top >= -1 && field.bottom <= field.viewportHeight + 1,
      `${description}: the search field is not reachable above the simulated keyboard ` +
        `(bounds=${field.top.toFixed(1)}–${field.bottom.toFixed(1)}px, viewport=${field.viewportHeight}px).`,
    );
  }
}

async function checkAdminSearchResultsAtLargeText(width) {
  const longName = "Ananya Daily007 Championship Champion With A Long Name";
  const longEmail = "ananya.champion.with.a.long.fake.address@example.invalid";
  const otherEmail = "rohan.preview.player@example.invalid";
  const searchCases = [
    {
      screen: "Wallet",
      tab: "wallet",
      input: "admin-wallet-user-search",
      actions: ["+ ADD", "− DEDUCT"],
    },
    {
      screen: "Users",
      tab: "users",
      input: "admin-users-search",
      actions: ["+ COINS", "− COINS", "BLOCK", "MAKE TOURNAMENT ADMIN"],
    },
  ];

  for (const screen of searchCases) {
    await clickSelector(`[data-testid="admin-tab-${screen.tab}"]`, `${screen.screen} tab`);
    await waitForCondition(
      `Boolean(document.querySelector('[data-testid="${screen.input}"]'))`,
      `${screen.screen} search field`,
    );

    for (const query of [longName, longEmail]) {
      const description = `${screen.screen} search for ${query === longName ? "the long fake name" : "the long fake email"}`;
      const selector = `[data-testid="${screen.input}"]`;
      await setInputValue(selector, query);
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      })()`);
      await assertAdminSearchField(screen.input, query, width, description);
      await assertAdminRowActionsFit(
        query,
        screen.actions,
        width,
        `${screen.screen} filtered result`,
      );
      const otherAccountVisible = await evaluate(
        `document.body.innerText.includes(${JSON.stringify(otherEmail)})`,
      );
      assert(!otherAccountVisible, `${description}: a non-matching account remained in the filtered results.`);
    }
  }
}

async function assertAdminSearchTextReachable(marker, width, description) {
  const state = await evaluate(`(() => {
    const element = [...document.querySelectorAll('*')]
      .find((item) => item.children.length === 0 && item.textContent.trim() === ${JSON.stringify(marker)});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent.trim(),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  })()`);
  assert(state, `${description}: the matching fake account text is missing.`);
  assert(
    state.left >= -1 && state.right <= width + 1 &&
      state.top >= -1 && state.bottom <= state.height + 1,
    `${description}: the matching fake account text cannot be reached in the ` +
      `${width}×${state.height}px keyboard-open viewport.`,
  );
}

async function checkAdminSearchAccessibility() {
  const width = 375;
  const longName = "Ananya Daily007 Championship Champion With A Long Name";
  const longEmail = "ananya.champion.with.a.long.fake.address@example.invalid";
  const otherName = "Rohan Free Fire Strategist";
  const otherEmail = "rohan.preview.player@example.invalid";
  const searchCases = [
    {
      screen: "Wallet",
      tab: "wallet",
      input: "admin-wallet-user-search",
      actions: ["+ ADD", "− DEDUCT"],
    },
    {
      screen: "Users",
      tab: "users",
      input: "admin-users-search",
      actions: ["+ COINS", "− COINS", "BLOCK", "MAKE TOURNAMENT ADMIN"],
    },
  ];

  async function announcementCount() {
    return evaluate("window.__daily007AccessibilityAnnouncements?.length ?? 0");
  }

  async function snapshotLiveRegion() {
    await evaluate(`(() => {
      window.__daily007PreviousAdminSearchLiveRegion =
        document.querySelector('[data-testid="admin-search-results-announcement"]');
      return true;
    })()`);
  }

  async function waitForAnnouncement(platform, text, previousCount, description) {
    if (platform === "ios") {
      await waitForCondition(
        `(() => {
          const announcements = window.__daily007AccessibilityAnnouncements ?? [];
          return announcements.length > ${previousCount} &&
            announcements.at(-1)?.message === ${JSON.stringify(text)};
        })()`,
        description,
      );
      const latest = await evaluate("window.__daily007AccessibilityAnnouncements?.at(-1) ?? null");
      assert(
        latest.options?.queue === true && latest.options?.priority === "low",
        `${description}: the iOS announcement should be queued at low priority.`,
      );
      return;
    }

    await waitForCondition(
      `(() => {
        const region = document.querySelector('[data-testid="admin-search-results-announcement"]');
        return region &&
          region !== window.__daily007PreviousAdminSearchLiveRegion &&
          region.textContent.trim() === ${JSON.stringify(text)};
      })()`,
      description,
    );
    const region = await evaluate(`(() => {
      const element = document.querySelector('[data-testid="admin-search-results-announcement"]');
      return {
        text: element?.textContent.trim() ?? null,
        live: element?.getAttribute("aria-live") ?? null,
      };
    })()`);
    assert(
      region.text === text && region.live === "polite",
      `${description}: Android should expose one polite live region, received ${JSON.stringify(region)}.`,
    );
  }

  async function enterQuery(platform, input, query, expectedText, description) {
    const previousCount = platform === "ios" ? await announcementCount() : null;
    if (platform !== "ios") await snapshotLiveRegion();
    await setInputValue(`[data-testid="${input}"]`, query);
    await waitForAnnouncement(platform, expectedText, previousCount, description);
    assert(
      await evaluate(`document.activeElement === document.querySelector('[data-testid="${input}"]')`),
      `${description}: focus moved away from the search field.`,
    );
  }

  for (const platform of ["android", "ios"]) {
    await setViewport(width, 1.5, "admin-narrow-preview.html", platform);
    assert(
      await evaluate("window.__daily007LargeTextScale === 1.5"),
      `${platform} search announcement preview did not apply 1.5× text.`,
    );

    for (const screen of searchCases) {
      await clickSelector(`[data-testid="admin-tab-${screen.tab}"]`, `${screen.screen} tab`);
      await waitForCondition(
        `Boolean(document.querySelector('[data-testid="${screen.input}"]'))`,
        `${screen.screen} search field`,
      );
      if (platform === "ios") {
        await evaluate("window.__daily007AccessibilityAnnouncements = []");
      }

      const firstAnnouncementCount = platform === "ios" ? await announcementCount() : null;
      if (platform !== "ios") await snapshotLiveRegion();
      await setInputValue(`[data-testid="${screen.input}"]`, longName);
      await waitForAnnouncement(
        platform,
        "1 matching user found.",
        firstAnnouncementCount,
        `${platform} ${screen.screen} matching-user announcement`,
      );
      assert(
        await evaluate(`document.activeElement === document.querySelector('[data-testid="${screen.input}"]')`),
        `${platform} ${screen.screen}: the matching-user announcement moved focus from search.`,
      );

      const matchingAccount = await evaluate(`(() => {
        const text = document.body.innerText;
        return {
          nameVisible: text.includes(${JSON.stringify(longName)}),
          emailVisible: text.includes(${JSON.stringify(longEmail)}),
          otherNameVisible: text.includes(${JSON.stringify(otherName)}),
          otherEmailVisible: text.includes(${JSON.stringify(otherEmail)}),
        };
      })()`);
      assert(
        matchingAccount.nameVisible && matchingAccount.emailVisible &&
          !matchingAccount.otherNameVisible && !matchingAccount.otherEmailVisible,
        `${screen.screen} should leave only the matching account details accessible: ${JSON.stringify(matchingAccount)}.`,
      );
      await assertAdminRowActionsFit(
        longName,
        screen.actions,
        width,
        `${screen.screen} filtered account actions after announcing the result`,
        { requireReachability: true },
      );
      assert(
        await evaluate(`document.activeElement === document.querySelector('[data-testid="${screen.input}"]')`),
        `${platform} ${screen.screen}: scrolling to the matching account actions moved focus from search.`,
      );

      const sameResultsCount = platform === "ios" ? await announcementCount() : null;
      if (platform !== "ios") await snapshotLiveRegion();
      await setInputValue(
        `[data-testid="${screen.input}"]`,
        "Ananya Daily007 Championship",
      );
      await delay(650);
      if (platform === "ios") {
        assert(
          await announcementCount() === sameResultsCount,
          `${platform} ${screen.screen}: changing the query without changing matching accounts repeated the announcement.`,
        );
      } else {
        assert(
          await evaluate(`document.querySelector('[data-testid="admin-search-results-announcement"]') ===
            window.__daily007PreviousAdminSearchLiveRegion`),
          `${platform} ${screen.screen}: changing the query without changing matching accounts repeated the announcement.`,
        );
      }
      assert(
        await evaluate(`document.activeElement === document.querySelector('[data-testid="${screen.input}"]')`),
        `${platform} ${screen.screen}: focus moved after the debounced duplicate check.`,
      );

      await enterQuery(
        platform,
        screen.input,
        otherName,
        "1 matching user found.",
        `${platform} ${screen.screen} changed matching user with the same result count`,
      );
      const changedResult = await evaluate(`(() => {
        const text = document.body.innerText;
        return {
          otherNameVisible: text.includes(${JSON.stringify(otherName)}),
          otherEmailVisible: text.includes(${JSON.stringify(otherEmail)}),
          originalNameVisible: text.includes(${JSON.stringify(longName)}),
        };
      })()`);
      assert(
        changedResult.otherNameVisible && changedResult.otherEmailVisible && !changedResult.originalNameVisible,
        `${screen.screen} did not keep the newly matched account details accessible: ${JSON.stringify(changedResult)}.`,
      );

      const beforeRapidQueries = platform === "ios" ? await announcementCount() : null;
      if (platform !== "ios") await snapshotLiveRegion();
      for (const query of ["not-a-preview-account", "still-no-account", "daily007-no-match"]) {
        await setInputValue(`[data-testid="${screen.input}"]`, query);
        if (platform === "ios") {
          assert(
            await announcementCount() === beforeRapidQueries,
            `${platform} ${screen.screen}: rapid typing announced an intermediate search result.`,
          );
        } else {
          assert(
            await evaluate(`document.querySelector('[data-testid="admin-search-results-announcement"]') ===
              window.__daily007PreviousAdminSearchLiveRegion`),
            `${platform} ${screen.screen}: rapid typing announced an intermediate search result.`,
          );
        }
      }
      await waitForAnnouncement(
        platform,
        "No matching users found.",
        beforeRapidQueries,
        `${platform} ${screen.screen} no-matches announcement after rapid typing`,
      );
      assert(
        await evaluate(`document.activeElement === document.querySelector('[data-testid="${screen.input}"]')`),
        `${platform} ${screen.screen}: focus moved after announcing no matches.`,
      );

      await enterQuery(
        platform,
        screen.input,
        "",
        "Search cleared. Showing 4 users.",
        `${platform} ${screen.screen} cleared-search announcement`,
      );
      assert(
        await evaluate(`document.activeElement === document.querySelector('[data-testid="${screen.input}"]')`),
        `${platform} ${screen.screen}: focus moved after clearing the search.`,
      );
    }
  }
}

function assertAdminNotificationAccessibilityProps() {
  const source = readFileSync(
    path.join(workspaceRoot, "artifacts/daily007/src/screens/AdminNotifications.tsx"),
    "utf8",
  );
  const checkboxStart = source.lastIndexOf(
    "<Pressable",
    source.indexOf('accessibilityRole="checkbox"'),
  );
  const checkboxEnd = source.indexOf("</Pressable>", checkboxStart);
  assert(
    checkboxStart >= 0 && checkboxEnd > checkboxStart,
    "The recipient checkbox source could not be isolated for its native accessibility checks.",
  );
  const checkboxSource = source.slice(checkboxStart, checkboxEnd);
  for (const [prop, description] of [
    ["accessible", "group each recipient into one accessible checkbox"],
    ['accessibilityRole="checkbox"', "expose the recipient as a checkbox"],
    ["accessibilityLabel={`Recipient:", "identify the recipient by name and email"],
    ["accessibilityHint=", "explain how to toggle the recipient"],
    ["accessibilityState={{ checked: on }}", "expose the checked or unchecked state"],
    ["onPress={() => toggleRecipient(id)}", "announce selection changes from the recipient action"],
  ]) {
    assert(
      checkboxSource.includes(prop),
      `The recipient control must ${description}.`,
    );
  }
  assert(
    source.includes('accessibilityLiveRegion="polite"') &&
      source.includes('testID="admin-notification-selection-announcement"'),
    "Android must receive selection-count changes through one polite announcement region.",
  );
  assert(
    source.includes("AccessibilityInfo.announceForAccessibilityWithOptions(message") &&
      source.includes("const sendAccessibilityLabel = type === 'selected'") &&
      source.includes("accessibilityLabel={sendAccessibilityLabel}"),
    "The selection count and targeted send action need clear screen-reader announcements.",
  );
  const templateStart = source.lastIndexOf(
    "<Pressable",
    source.indexOf("testID={`admin-notification-template-"),
  );
  const templateEnd = source.indexOf("</Pressable>", templateStart);
  assert(
    templateStart >= 0 && templateEnd > templateStart,
    "The notification template button source could not be isolated for its accessibility checks.",
  );
  const templateSource = source.slice(templateStart, templateEnd);
  for (const [prop, description] of [
    ["accessible", "make each template available as one screen-reader target"],
    ['accessibilityRole="button"', "expose each template as a button"],
    ["accessibilityLabel={`Use ${tpl.t} template`}", "name the action and template"],
    [
      'accessibilityHint={`Prefills the notification title with "${tpl.t}" and the message with: ${tpl.b}`}',
      "describe which title and message will be filled",
    ],
    [
      "onPress={() => { setTitle(tpl.t); setBody(tpl.b); }}",
      "fill both notification fields when activated",
    ],
  ]) {
    assert(
      templateSource.includes(prop),
      `Each notification template must ${description}.`,
    );
  }
}

async function checkAdminNotificationsAccessibility() {
  const width = 375;
  const templates = [
    {
      slug: "tournament-announcement",
      title: "Tournament Announcement",
      body: "A new tournament is live! Register now — limited slots.",
    },
    {
      slug: "room-published",
      title: "Room Published",
      body: "Room ID & password are now visible in My Matches. Join on time!",
    },
    {
      slug: "winner-announcement",
      title: "Winner Announcement",
      body: "Congratulations to our BOOYAH winner! Please check the announced results and reward status.",
    },
  ];
  const recipients = [
    {
      id: "preview-user-ananya-championship-2026",
      name: "Ananya Daily007 Championship Champion With A Long Name",
      email: "ananya.champion.with.a.long.fake.address@example.invalid",
    },
    {
      id: "preview-user-rohan-free-fire-2026",
      name: "Rohan Free Fire Strategist",
      email: "rohan.preview.player@example.invalid",
    },
    {
      id: "preview-notification-recipient-meera-2026",
      name: "Meera Daily007 International Free Fire Championship Player",
      email: "meera.international.championship.preview@example.invalid",
    },
    {
      id: "preview-notification-recipient-kabir-2026",
      name: "Kabir Free Fire National Tournament Finalist and Squad Captain",
      email: "kabir.national.tournament.finalist.preview@example.invalid",
    },
  ];
  const firstRecipientId = recipients[0].id;
  const secondRecipientId = recipients[1].id;

  assertAdminNotificationAccessibilityProps();
  await setViewport(width, 1.5, "admin-narrow-preview.html", "android");
  assert(
    await evaluate(
      `window.innerWidth === ${width} && window.__daily007LargeTextScale === 1.5`,
    ),
    "The Admin notification accessibility preview did not apply its Android-sized viewport.",
  );
  await openAdminTab("notifications", "Notifications");
  await resetAdminMutationCalls();
  assertAdminNotificationAccessibilityProps();
  for (const template of templates) {
    const selector = `[data-testid="admin-notification-template-${template.slug}"]`;
    const control = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return {
        role: element?.getAttribute("role") ?? null,
        label: element?.getAttribute("aria-label") ?? null,
        title: element?.textContent.trim() ?? null,
      };
    })()`);
    assert(
      control.role === "button" &&
        control.label === `Use ${template.title} template` &&
        control.title?.includes(template.title),
      `TalkBack needs a button named for the ${template.title} template: ${JSON.stringify(control)}.`,
    );
    const focusedBeforeActivation = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.focus();
      if (document.activeElement !== element) return false;
      element.click();
      return true;
    })()`);
    assert(
      focusedBeforeActivation,
      `${template.title} template could not be focused and activated in the isolated preview.`,
    );
    await waitForCondition(
      `document.querySelector('[data-testid="admin-notification-title"]')?.value === ${JSON.stringify(template.title)} &&
        document.querySelector('[data-testid="admin-notification-body"]')?.value === ${JSON.stringify(template.body)}`,
      `the ${template.title} template to fill both notification fields`,
    );
    const activation = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return {
        focusedAfter: document.activeElement === element,
        title: document.querySelector('[data-testid="admin-notification-title"]')?.value ?? null,
        body: document.querySelector('[data-testid="admin-notification-body"]')?.value ?? null,
      };
    })()`);
    assert(
      activation.focusedAfter &&
        activation.title === template.title &&
        activation.body === template.body,
      `Activating the ${template.title} template must fill both fields without moving focus: ${JSON.stringify(activation)}.`,
    );
  }
  const templateMutations = await evaluate(
    "window.__daily007AdminMutations?.calls ?? []",
  );
  assert(
    Array.isArray(templateMutations) && templateMutations.length === 0,
    `Activating preview templates must not call an API mutation: ${JSON.stringify(templateMutations)}.`,
  );
  await clickSelector(
    '[data-testid="notification-type-selected"]',
    "Select Users notification audience",
  );
  await waitForCondition(
    `document.querySelectorAll('[data-testid^="notification-recipient-"]').length === ${recipients.length}`,
    "all isolated notification recipient checkboxes",
  );
  await evaluate("window.__daily007AccessibilityAnnouncements = []");

  const renderedRecipients = await evaluate(`(() => [...document.querySelectorAll('[data-testid^="notification-recipient-"]')]
    .map((element) => ({
      id: element.getAttribute("data-testid")?.replace("notification-recipient-", ""),
      role: element.getAttribute("role"),
      label: element.getAttribute("aria-label"),
      checked: element.getAttribute("aria-checked"),
    })))()`);
  assert(
    renderedRecipients.length === recipients.length,
    `Expected ${recipients.length} isolated notification recipients, got ${JSON.stringify(renderedRecipients)}.`,
  );
  for (const recipient of recipients) {
    const row = renderedRecipients.find((item) => item.id === recipient.id);
    assert(
      row?.role === "checkbox" &&
        row.label?.includes(recipient.name) &&
        row.label?.includes(recipient.email),
      `TalkBack needs one checkbox with a clear name and email for ${recipient.id}: ${JSON.stringify(row)}.`,
    );
    if (row.checked !== null) {
      assert(
        row.checked === "false",
        `An unselected recipient must expose unchecked state: ${JSON.stringify(row)}.`,
      );
    }
  }

  async function toggleAndVerify(recipientId, expectedCount, expectedChecked, message, description) {
    const selector = `[data-testid="notification-recipient-${recipientId}"]`;
    const beforeAnnouncementCalls = await evaluate(
      "window.__daily007AccessibilityAnnouncements?.length ?? 0",
    );
    await evaluate(`(() => {
      window.__daily007PreviousNotificationSelectionAnnouncement =
        document.querySelector('[data-testid="admin-notification-selection-announcement"]');
      return true;
    })()`);
    const activatedWithoutMovingFocus = await evaluate(`(() => {
      const recipient = document.querySelector(${JSON.stringify(selector)});
      if (!recipient) return false;
      recipient.focus();
      if (document.activeElement !== recipient) return false;
      recipient.click();
      return document.activeElement === recipient;
    })()`);
    assert(
      activatedWithoutMovingFocus,
      `${description} unexpectedly moved accessibility focus from the activated recipient.`,
    );
    await waitForCondition(
      `(() => {
        const prior = window.__daily007PreviousNotificationSelectionAnnouncement;
        const region = document.querySelector('[data-testid="admin-notification-selection-announcement"]');
        return region && region !== prior && region.textContent.trim() === ${JSON.stringify(message)};
      })()`,
      `${description} selection-count announcement`,
    );
    const result = await evaluate(`(() => {
      const region = document.querySelector('[data-testid="admin-notification-selection-announcement"]');
      const recipient = document.querySelector(${JSON.stringify(selector)});
      const count = document.querySelector('[data-testid="admin-notification-recipient-count"]');
      return {
        text: region?.textContent.trim() ?? null,
        live: region?.getAttribute("aria-live") ?? null,
        regionCount: document.querySelectorAll('[data-testid="admin-notification-selection-announcement"]').length,
        checked: recipient?.getAttribute("aria-checked") ?? null,
        focused: document.activeElement === recipient,
        countText: count?.textContent.trim() ?? null,
      };
    })()`);
    const expectedCountText = `RECIPIENTS · ${expectedCount} selected`;
    assert(
      result.text === message && result.live === "polite" && result.regionCount === 1,
      `${description} must produce exactly one polite count announcement: ${JSON.stringify(result)}.`,
    );
    assert(
      result.focused && result.countText === expectedCountText,
      `${description} must keep focus on the recipient and update the visible count: ${JSON.stringify(result)}.`,
    );
    if (result.checked !== null) {
      assert(
        result.checked === (expectedChecked ? "true" : "false"),
        `${description} exposed the wrong checkbox state: ${JSON.stringify(result)}.`,
      );
    }
    assert(
      await evaluate("window.__daily007AccessibilityAnnouncements?.length ?? 0") === beforeAnnouncementCalls,
      `${description} must not duplicate the Android live-region update with an imperative announcement.`,
    );
  }

  await toggleAndVerify(
    firstRecipientId,
    1,
    true,
    "1 recipient selected.",
    "Selecting the first fake recipient",
  );
  await toggleAndVerify(
    secondRecipientId,
    2,
    true,
    "2 recipients selected.",
    "Selecting the second fake recipient",
  );
  await toggleAndVerify(
    firstRecipientId,
    1,
    false,
    "1 recipient selected.",
    "Unselecting the first fake recipient",
  );
  await toggleAndVerify(
    secondRecipientId,
    0,
    false,
    "No recipients selected.",
    "Unselecting the last fake recipient",
  );
  await toggleAndVerify(
    firstRecipientId,
    1,
    true,
    "1 recipient selected.",
    "Selecting one fake recipient for delivery",
  );

  const sendAction = await evaluate(`(() => {
    const action = document.querySelector('[data-testid="admin-notification-send"]');
    return {
      role: action?.getAttribute("role") ?? null,
      label: action?.getAttribute("aria-label") ?? null,
    };
  })()`);
  assert(
    sendAction.role === "button" &&
      sendAction.label === "Send notification to 1 selected recipient",
    `The send action must announce the selected audience: ${JSON.stringify(sendAction)}.`,
  );
  await setTournamentFormValue(
    '[data-testid="admin-notification-title"]',
    "Accessibility preview update",
  );
  await setTournamentFormValue(
    '[data-testid="admin-notification-body"]',
    "This notification is sent only to the isolated preview recipient.",
  );
  await resetAdminMutationCalls();
  const holdConfigured = await evaluate(`(() => {
    const tracker = window.__daily007AdminMutations;
    if (!tracker?.holdNextNotificationSend) return false;
    tracker.holdNextNotificationSend();
    return true;
  })()`);
  assert(holdConfigured, "The isolated preview could not hold a targeted notification send.");
  try {
    await clickSelector(
      '[data-testid="admin-notification-send"]',
      "Send notification to the selected fake recipient",
    );
    await assertAdminMutation({
      method: "adminSendNotification",
      payload: {
        title: "Accessibility preview update",
        body: "This notification is sent only to the isolated preview recipient.",
        type: "selected",
        userIds: [firstRecipientId],
      },
    }, "Accessible selected-recipient notification");
    await delay(60);
    const pendingAction = await evaluate(`(() => {
      const action = document.querySelector('[data-testid="admin-notification-send"]');
      return {
        disabled: action?.disabled ?? null,
        progress: Boolean(action?.querySelector('[role="progressbar"]')),
      };
    })()`);
    assert(
      pendingAction.disabled === true && pendingAction.progress,
      `The targeted notification action must remain disabled and busy while its request is pending: ${JSON.stringify(pendingAction)}.`,
    );
    await clickSelector(
      '[data-testid="admin-notification-send"]',
      "Tap the busy targeted notification action a second time",
    );
    const pendingState = await evaluate(`(() => {
      const action = document.querySelector('[data-testid="admin-notification-send"]');
      return {
        calls: window.__daily007AdminMutations?.calls ?? null,
        disabled: action?.disabled ?? null,
        progress: Boolean(action?.querySelector('[role="progressbar"]')),
      };
    })()`);
    assert(
      Array.isArray(pendingState.calls) &&
        pendingState.calls.length === 1 &&
        pendingState.calls[0].method === "adminSendNotification" &&
        pendingState.disabled === true &&
        pendingState.progress,
      `A second tap must not duplicate the targeted send or clear its busy state before completion: ${JSON.stringify(pendingState)}.`,
    );
    const released = await evaluate(
      "window.__daily007AdminMutations?.releaseHeldNotificationSend?.() ?? false",
    );
    assert(released, "The isolated targeted notification request was not released.");
  } finally {
    await evaluate("window.__daily007AdminMutations?.releaseHeldNotificationSend?.()");
  }
  await waitForCondition(
    `Boolean(document.querySelector('[aria-live="polite"][aria-label="Notification sent"]'))`,
    "polite notification-sent completion feedback",
  );
  const completedAction = await evaluate(`(() => {
    const action = document.querySelector('[data-testid="admin-notification-send"]');
    return {
      disabled: action?.disabled ?? null,
      progress: Boolean(action?.querySelector('[role="progressbar"]')),
    };
  })()`);
  assert(
    completedAction.disabled === false && !completedAction.progress,
    `The targeted notification action must clear its busy state after completion: ${JSON.stringify(completedAction)}.`,
  );
  const completion = await evaluate(`(() => {
    const toast = document.querySelector('[aria-live="polite"][aria-label="Notification sent"]');
    return {
      label: toast?.getAttribute("aria-label") ?? null,
      live: toast?.getAttribute("aria-live") ?? null,
      text: toast?.textContent.trim() ?? null,
    };
  })()`);
  assert(
    completion.label === "Notification sent" &&
      completion.live === "polite" &&
      completion.text?.includes("Notification sent"),
    `The send completion must be announced politely and clearly: ${JSON.stringify(completion)}.`,
  );
}

async function checkAdminSearchResultsWithKeyboard() {
  const width = 375;
  const keyboardHeight = 450;
  const longName = "Ananya Daily007 Championship Champion With A Long Name";
  const longEmail = "ananya.champion.with.a.long.fake.address@example.invalid";
  const otherEmail = "rohan.preview.player@example.invalid";
  const searchCases = [
    {
      screen: "Wallet",
      tab: "wallet",
      input: "admin-wallet-user-search",
      actions: ["+ ADD", "− DEDUCT"],
    },
    {
      screen: "Users",
      tab: "users",
      input: "admin-users-search",
      actions: ["+ COINS", "− COINS", "BLOCK", "MAKE TOURNAMENT ADMIN"],
    },
  ];

  await setViewport(width, 1.5);
  assert(
    await evaluate("window.__daily007LargeTextScale === 1.5"),
    "The Admin keyboard search preview did not apply 1.5× Android text.",
  );
  await openAdminKeyboardViewport(keyboardHeight);
  await waitForCondition(
    `window.innerWidth === ${width} && window.innerHeight === ${keyboardHeight}`,
    "the 375×450 viewport with the simulated Android keyboard open",
  );

  for (const screen of searchCases) {
    await clickSelector(`[data-testid="admin-tab-${screen.tab}"]`, `${screen.screen} tab`);
    await waitForCondition(
      `Boolean(document.querySelector('[data-testid="${screen.input}"]'))`,
      `${screen.screen} search field`,
    );

    for (const query of [longName, longEmail]) {
      const description =
        `${screen.screen} search for ${query === longName ? "the long fake name" : "the long fake email"} with keyboard open`;
      const selector = `[data-testid="${screen.input}"]`;
      await setInputValue(selector, query);
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      })()`);
      await assertAdminSearchField(
        screen.input,
        query,
        width,
        description,
        { requireViewportVisibility: true },
      );

      const matchingAccount = await evaluate(`(() => {
        const text = document.body.innerText;
        return {
          nameVisible: text.includes(${JSON.stringify(longName)}),
          emailVisible: text.includes(${JSON.stringify(longEmail)}),
          otherAccountVisible: text.includes(${JSON.stringify(otherEmail)}),
        };
      })()`);
      assert(
        matchingAccount.nameVisible && matchingAccount.emailVisible,
        `${description}: the matching fake account is missing its name or email.`,
      );
      assert(
        !matchingAccount.otherAccountVisible,
        `${description}: a non-matching fake account remained in the filtered results.`,
      );

      await assertAdminSearchTextReachable(
        longName,
        width,
        `${screen.screen} matching fake account name`,
      );
      await assertAdminSearchTextReachable(
        longEmail,
        width,
        `${screen.screen} matching fake account email`,
      );
      await assertAdminRowActionsFit(
        query,
        screen.actions,
        width,
        `${screen.screen} keyboard-open filtered result`,
        { requireReachability: true },
      );

      const retainedQuery = await evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.value ?? null`,
      );
      assert(
        retainedQuery === query,
        `${description}: the entered query was lost while scrolling to the matching account actions.`,
      );
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
      await assertAdminSearchField(
        screen.input,
        query,
        width,
        description,
        { requireViewportVisibility: true },
      );
      assert(
        await evaluate(`window.innerHeight === ${keyboardHeight}`),
        `${description}: the simulated keyboard viewport changed during scrolling.`,
      );
    }

    if (screen.tab === "users") {
      const query = "no-admin-user-will-match";
      const selector = `[data-testid="${screen.input}"]`;
      await setInputValue(selector, "");
      await waitForCondition(
        `document.body.innerText.includes(${JSON.stringify(longEmail)}) &&
          document.body.innerText.includes(${JSON.stringify(otherEmail)}) &&
          document.body.innerText.includes("4 users")`,
        "the unfiltered Admin Users list before the no-match recovery check",
      );
      const baseline = await evaluate(`(() => ({
        roles: [...document.querySelectorAll(
          '[aria-label$=", Full Admin"], [aria-label$=", Tournament Admin"], [aria-label$=", Player"]'
        )].map((element) => element.getAttribute("aria-label")).sort(),
      }))()`);
      assert(
        baseline.roles.length === 4,
        `The unfiltered Admin Users preview should expose all four account roles: ${JSON.stringify(baseline)}.`,
      );

      await resetAdminMutationCalls();
      await setInputValue(selector, query);

      const emptyState = await evaluate(`(() => {
        const button = document.querySelector('[data-testid="admin-users-clear-search"]');
        if (!button) return null;
        button.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = button.getBoundingClientRect();
        return {
          messageVisible: document.body.innerText.includes("No users match this search."),
          queryValue: document.querySelector(${JSON.stringify(selector)})?.value ?? null,
          label: button.getAttribute("aria-label"),
          role: button.getAttribute("role"),
          disabled: button.getAttribute("aria-disabled") === "true" || button.disabled === true,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      })()`);
      assert(emptyState, "Admin Users did not show a visible clear-search control for a no-match query.");
      assert(
        emptyState.messageVisible && emptyState.queryValue === query,
        `Admin Users did not show its no-match message for the active search: ${JSON.stringify(emptyState)}.`,
      );
      assert(
        emptyState.label === "Clear Admin Users search" &&
          emptyState.role === "button" &&
          !emptyState.disabled,
        `The no-match recovery action is not exposed as an enabled, accessible button: ${JSON.stringify(emptyState)}.`,
      );
      assert(
        emptyState.width > 0 &&
          emptyState.height >= minimumAndroidTouchTarget &&
          emptyState.left >= -1 &&
          emptyState.right <= width + 1 &&
          emptyState.top >= -1 &&
          emptyState.bottom <= keyboardHeight + 1,
        `The no-match recovery action is clipped or too small at ${width}×${keyboardHeight} with 1.5× text: ${JSON.stringify(emptyState)}.`,
      );
      await assertPageHasNoHorizontalOverflow(
        width,
        "Admin Users no-match state with the Android keyboard open at 1.5× text",
      );

      await tapSelector('[data-testid="admin-users-clear-search"]', "Admin Users clear-search button");
      await waitForCondition(
        `document.querySelector(${JSON.stringify(selector)})?.value === "" &&
          document.body.innerText.includes(${JSON.stringify(longEmail)}) &&
          document.body.innerText.includes(${JSON.stringify(otherEmail)})`,
        "the full Admin Users list after clearing the no-match search",
      );
      const recovered = await evaluate(`(() => ({
        queryValue: document.querySelector(${JSON.stringify(selector)})?.value ?? null,
        userCountVisible: document.body.innerText.includes("4 users"),
        firstAccountVisible:
          document.body.innerText.includes(${JSON.stringify(longName)}) &&
          document.body.innerText.includes(${JSON.stringify(longEmail)}),
        secondAccountVisible:
          document.body.innerText.includes("Rohan Free Fire Strategist") &&
          document.body.innerText.includes(${JSON.stringify(otherEmail)}),
        roles: [...document.querySelectorAll(
          '[aria-label$=", Full Admin"], [aria-label$=", Tournament Admin"], [aria-label$=", Player"]'
        )].map((element) => element.getAttribute("aria-label")).sort(),
        mutationCalls: window.__daily007AdminMutations?.calls ?? null,
        viewportHeight: window.innerHeight,
      }))()`);
      assert(
        recovered.queryValue === "" &&
          recovered.userCountVisible &&
          recovered.firstAccountVisible &&
          recovered.secondAccountVisible &&
          JSON.stringify(recovered.roles) === JSON.stringify(baseline.roles) &&
          recovered.viewportHeight === keyboardHeight,
        `Clearing the search did not restore the Admin Users list in the keyboard-open viewport: ${JSON.stringify(recovered)}.`,
      );
      assert(
        Array.isArray(recovered.mutationCalls) && recovered.mutationCalls.length === 0,
        `Clearing Admin Users search changed account data or permissions: ${JSON.stringify(recovered.mutationCalls)}.`,
      );
    }
  }
}

async function checkAdminSelectedRecordMutations() {
  assert(
    await evaluate("Boolean(window.__daily007AdminMutations?.reset)"),
    "The isolated Admin mutation-call tracker is not installed.",
  );
  const registrationMarker =
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad";
  const registrationToRejectMarker =
    "Rohan Free Fire Strategist — Preview Registration To Reject";
  const approvedRegistrationMarker = "Rohan Free Fire Strategist — Preview Approved Team";

  await clickSelector('[data-testid="admin-tab-registrations"]', "Registrations tab");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(registrationMarker)})`,
    "the selected fake registration to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(registrationMarker, "APPROVE", "pending registration");
  await assertAdminMutation({
    method: "adminRegAction",
    id: "preview-registration-pending-long-identifier-2026",
    action: "approve",
  }, "Registration approval");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(registrationMarker)})`,
    "the approved registration to leave the pending list",
  );
  await assertText(registrationToRejectMarker, "the unrelated pending registration");
  await clickTextLabel("APPROVED");
  await assertText(registrationMarker, "the approved selected registration");
  await assertText(approvedRegistrationMarker, "the unrelated approved registration");
  await assertBodyTextAbsent(registrationToRejectMarker, "the still-pending registration in the approved list");

  await clickTextLabel("PENDING");
  await assertText(registrationToRejectMarker, "the pending registration selected for rejection");
  await resetAdminMutationCalls();
  await clickRowButton(registrationToRejectMarker, "REJECT", "pending registration");
  await assertAdminMutation({
    method: "adminRegAction",
    id: "preview-registration-pending-rejection-2026",
    action: "reject",
  }, "Registration rejection");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(registrationToRejectMarker)})`,
    "the rejected registration to leave the pending list",
  );
  await clickTextLabel("REJECTED");
  await assertText(registrationToRejectMarker, "the rejected selected registration");
  await assertText("Preview Rejected Player — Preview Rejected Team", "the unrelated rejected registration");
  await assertBodyTextAbsent(registrationMarker, "the approved registration in the rejected list");

  await clickTextLabel("APPROVED");
  await assertText(registrationMarker, "the approved registration retained after another registration was rejected");
  await assertText(approvedRegistrationMarker, "the approved registration selected for deletion");
  await resetAdminMutationCalls();
  await clickRowButton(approvedRegistrationMarker, "DELETE", "approved registration");
  await assertAdminMutation({
    method: "adminDeleteRegistration",
    id: "preview-registration-approved-2026",
  }, "Registration deletion");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(registrationMarker)}) && !document.body.innerText.includes(${JSON.stringify(approvedRegistrationMarker)})`,
    "the selected registration to be deleted while the unrelated approved registration remains",
  );

  await clickSelector('[data-testid="admin-tab-payments"]', "Payments tab");
  const paymentMarker =
    "Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026";
  const paymentToRejectMarker =
    "Kavya Championship Deposit To Reject · User ID: preview-user-payment-rejection-2026";
  const pendingWithdrawalMarker =
    "Rohan International Tournament Champion · User ID: preview-user-rohan-championship-account-2026";
  const withdrawalToApproveMarker =
    "Meera Pending Payout To Approve · User ID: preview-user-withdrawal-approval-2026";
  const approvedPayoutMarker =
    "Approved Preview Payout Player · User ID: preview-user-approved-payout-2026";
  const approvedPayoutControlMarker =
    "Control Approved Payout Player · User ID: preview-user-approved-payout-control-2026";
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(paymentMarker)})`,
    "the selected fake deposit to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(paymentMarker, "APPROVE", "pending deposit");
  await assertAdminMutation({
    method: "adminPaymentAction",
    id: "preview-payment-pending-long-reference-2026",
    action: "approve",
  }, "Deposit approval");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(paymentMarker)}) && document.body.innerText.includes(${JSON.stringify(paymentToRejectMarker)}) && document.body.innerText.includes(${JSON.stringify(pendingWithdrawalMarker)})`,
    "the approved deposit to leave pending while unrelated requests remain pending",
  );

  await resetAdminMutationCalls();
  await clickRowButton(paymentToRejectMarker, "REJECT", "pending deposit");
  await assertText("Reject request", "the deposit rejection dialog");
  await setLastVisibleInput("Preview deposit rejection reason", "deposit rejection reason");
  await clickDialogButton("Reject request", "REJECT", "deposit rejection dialog");
  await assertAdminMutation({
    method: "adminPaymentAction",
    id: "preview-payment-pending-rejection-2026",
    action: "reject",
    reason: "Preview deposit rejection reason",
  }, "Deposit rejection");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(paymentToRejectMarker)}) && document.body.innerText.includes(${JSON.stringify(pendingWithdrawalMarker)})`,
    "the rejected deposit to leave pending while the withdrawals remain pending",
  );

  await clickTextLabel("REJECTED");
  await assertText(paymentToRejectMarker, "the rejected deposit");
  await waitForCondition(
    "document.body.innerText.includes('Review note: Preview deposit rejection reason')",
    "the rejected deposit reason to appear",
  );
  await assertBodyTextAbsent(paymentMarker, "the approved deposit in the rejected list");

  await clickTextLabel("PENDING");
  await assertText(pendingWithdrawalMarker, "the pending withdrawal selected for rejection");
  await assertText(withdrawalToApproveMarker, "the unrelated pending withdrawal");
  await resetAdminMutationCalls();
  await clickRowButton(pendingWithdrawalMarker, "REJECT", "pending withdrawal");
  await assertText("Reject request", "the withdrawal rejection dialog");
  await setLastVisibleInput("Preview withdrawal rejection reason", "withdrawal rejection reason");
  await clickDialogButton("Reject request", "REJECT", "withdrawal rejection dialog");
  await assertAdminMutation({
    method: "adminWithdrawalAction",
    id: "preview-withdrawal-pending-long-reference-2026",
    action: "reject",
    reason: "Preview withdrawal rejection reason",
  }, "Withdrawal rejection");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(pendingWithdrawalMarker)}) && document.body.innerText.includes(${JSON.stringify(withdrawalToApproveMarker)})`,
    "the rejected withdrawal to leave pending while the other withdrawal remains pending",
  );
  await clickTextLabel("REJECTED");
  await assertText(pendingWithdrawalMarker, "the rejected withdrawal");
  await waitForCondition(
    "document.body.innerText.includes('Review note: Preview withdrawal rejection reason')",
    "the rejected withdrawal reason to appear",
  );
  await assertText(paymentToRejectMarker, "the unrelated rejected deposit");

  await clickTextLabel("PENDING");
  await assertText(withdrawalToApproveMarker, "the unrelated pending withdrawal retained after rejection");
  await resetAdminMutationCalls();
  await clickRowButton(withdrawalToApproveMarker, "APPROVE", "pending withdrawal");
  await assertAdminMutation({
    method: "adminWithdrawalAction",
    id: "preview-withdrawal-pending-approval-2026",
    action: "approve",
  }, "Withdrawal approval");
  await waitForCondition(
    `!document.body.innerText.includes(${JSON.stringify(withdrawalToApproveMarker)})`,
    "the approved withdrawal to leave pending",
  );

  await clickTextLabel("APPROVED");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(approvedPayoutMarker)}) && document.body.innerText.includes(${JSON.stringify(withdrawalToApproveMarker)}) && document.body.innerText.includes(${JSON.stringify(paymentMarker)})`,
    "the approved deposit and withdrawals to load",
  );
  await assertAdminRecordState(
    approvedPayoutMarker,
    { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
    "the approved withdrawal awaiting its manual payout",
  );
  await assertText(approvedPayoutControlMarker, "the unrelated approved withdrawal");
  await resetAdminMutationCalls();
  await clickRowButton(approvedPayoutMarker, "RECORD MANUAL PAYOUT SENT", "approved withdrawal");
  await assertText("Record manual payout", "the manual payout confirmation");
  await clickDialogButton("Record manual payout", "MARK PAID", "manual payout confirmation");
  await assertAdminMutation({
    method: "adminMarkWithdrawalPaid",
    id: "preview-withdrawal-approved-manual-payout-2026",
  }, "Manual withdrawal payout");
  await waitForAdminRecordState(
    approvedPayoutMarker,
    { includes: ["PAID"], excludes: ["RECORD MANUAL PAYOUT SENT"] },
    "the withdrawal with its manual payout recorded",
  );
  const paidStatusAccessibleLabel = await evaluate(
    `document.querySelector('[data-testid="withdrawal-payout-status-preview-withdrawal-approved-manual-payout-2026"]')?.getAttribute('aria-label')`,
  );
  assert(
    paidStatusAccessibleLabel === "Payout status: Paid",
    `The paid payout status should have a clear accessibility label. Received: ${JSON.stringify(paidStatusAccessibleLabel)}`,
  );
  const paidStatusLiveRegion = await evaluate(
    `document.querySelector('[data-testid="withdrawal-payout-status-preview-withdrawal-approved-manual-payout-2026"]')?.getAttribute('aria-live')`,
  );
  assert(
    paidStatusLiveRegion === "polite",
    `The paid payout status should be a polite live region. Received: ${JSON.stringify(paidStatusLiveRegion)}`,
  );
  await waitForCondition(
    "!document.body.innerText.includes('Record manual payout')",
    "the completed payout confirmation to close",
  );
  await assertAdminRecordState(
    approvedPayoutControlMarker,
    { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
    "the unrelated approved withdrawal",
  );
  await assertAdminRecordState(
    withdrawalToApproveMarker,
    { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
    "the separately approved withdrawal",
  );

  await clickSelector('[data-testid="admin-tab-wallet"]', "Wallet tab");
  const userEmail = "ananya.champion.with.a.long.fake.address@example.invalid";
  const otherUserEmail = "rohan.preview.player@example.invalid";
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(userEmail)})`,
    "the selected fake Wallet user to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(userEmail, "+ ADD", "Wallet user");
  await assertText("Add coins", "the Wallet coin adjustment dialog");
  await setLastVisibleInput("321", "Wallet coin amount");
  await clickDialogButton("Add coins", "ADD", "Wallet coin adjustment dialog");
  await assertAdminMutation({
    method: "adminAdjustCoins",
    userId: "preview-user-ananya-championship-2026",
    amount: 321,
    reason: "Admin added coins",
  }, "Wallet coin addition");
  await waitForAdminRecordState(
    userEmail,
    { includes: ["987654642 COINS"] },
    "the wallet user after coins were added",
  );
  await assertAdminRecordState(
    otherUserEmail,
    { includes: ["425000 COINS"] },
    "the unrelated wallet user after coins were added",
  );

  await resetAdminMutationCalls();
  await clickRowButton(userEmail, "− DEDUCT", "Wallet user");
  await assertText("Deduct coins", "the Wallet deduction dialog");
  await setLastVisibleInput("87", "Wallet coin deduction amount");
  await clickDialogButton("Deduct coins", "DEDUCT", "Wallet deduction dialog");
  await assertAdminMutation({
    method: "adminAdjustCoins",
    userId: "preview-user-ananya-championship-2026",
    amount: -87,
    reason: "Admin deducted coins",
  }, "Wallet coin deduction");
  await waitForAdminRecordState(
    userEmail,
    { includes: ["987654555 COINS"] },
    "the wallet user after coins were deducted",
  );
  await assertAdminRecordState(
    otherUserEmail,
    { includes: ["425000 COINS"] },
    "the unrelated wallet user after coins were deducted",
  );

  await clickSelector('[data-testid="admin-tab-users"]', "Users tab");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(userEmail)})`,
    "the selected fake Admin user to load",
  );
  const userId = "preview-user-ananya-championship-2026";
  const otherUserId = "preview-user-rohan-free-fire-2026";

  await assertAdminRecordState(
    userEmail,
    { includes: ["PLAYER", "987654555 COINS"], excludes: ["· BLOCKED"] },
    "the unchanged target user before role changes",
  );
  await assertAdminRecordState(
    otherUserEmail,
    { includes: ["TOURNAMENT ADMIN", "· BLOCKED", "425000 COINS"] },
    "the other user before role changes",
  );

  await resetAdminMutationCalls();
  await clickSelector(`[data-testid="change-user-role-${otherUserId}"]`, "other user role action");
  await clickSelector('[data-testid="confirm-tournament-admin-change"]', "confirm other user role action");
  await assertAdminMutation({
    method: "adminSetUserRole",
    id: otherUserId,
    role: "user",
  }, "Other user role change");
  await waitForAdminRecordState(
    otherUserEmail,
    { includes: ["PLAYER", "· BLOCKED"] },
    "the other user after their role changed",
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["PLAYER", "987654555 COINS"], excludes: ["· BLOCKED"] },
    "the unrelated user after the other user's role changed",
  );

  await resetAdminMutationCalls();
  await clickSelector(`[data-testid="change-user-role-${userId}"]`, "user role action");
  await clickSelector('[data-testid="confirm-tournament-admin-change"]', "confirm user role action");
  await assertAdminMutation({
    method: "adminSetUserRole",
    id: userId,
    role: "tournament_admin",
  }, "User role change");
  await waitForAdminRecordState(
    userEmail,
    { includes: ["TOURNAMENT ADMIN", "987654555 COINS"], excludes: ["· BLOCKED"] },
    "the selected user after their role changed",
  );
  await assertAdminRecordState(
    otherUserEmail,
    { includes: ["PLAYER", "· BLOCKED", "425000 COINS"] },
    "the other user after the selected user's role changed",
  );

  await resetAdminMutationCalls();
  await clickRowButton(otherUserEmail, "UNBLOCK", "blocked Admin user");
  const unblockPrompt = await evaluate(`(() => {
    const alert = window.__daily007AdminAlert;
    return alert ? { kind: alert.kind, title: alert.title, message: alert.message, buttons: alert.buttons } : null;
  })()`);
  assert(
    unblockPrompt?.kind === "alert" &&
      unblockPrompt.title === "Unblock user?" &&
      unblockPrompt.buttons?.includes("Unblock"),
    `Unblocking the selected user did not request the expected confirmation: ${JSON.stringify(unblockPrompt)}.`,
  );
  await evaluate(`window.__daily007AdminAlert.choose("Unblock")`);
  await assertAdminMutation({
    method: "adminSetUser",
    id: otherUserId,
    payload: { status: "active" },
  }, "User unblock");
  await waitForAdminRecordState(
    otherUserEmail,
    { includes: ["PLAYER", "425000 COINS"], excludes: ["· BLOCKED"] },
    "the unblocked user",
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["TOURNAMENT ADMIN", "987654555 COINS"], excludes: ["· BLOCKED"] },
    "the unrelated user after the other user's status changed",
  );

  await resetAdminMutationCalls();
  await clickRowButton(userEmail, "BLOCK", "Admin user");
  const blockPrompt = await evaluate(`(() => {
    const alert = window.__daily007AdminAlert;
    return alert ? { kind: alert.kind, title: alert.title, message: alert.message, buttons: alert.buttons } : null;
  })()`);
  assert(
    blockPrompt?.kind === "alert" && blockPrompt.title === "Block user?" && blockPrompt.buttons?.includes("Block"),
    `Blocking the selected user did not request the expected confirmation: ${JSON.stringify(blockPrompt)}.`,
  );
  await evaluate(`window.__daily007AdminAlert.choose("Block")`);
  await assertAdminMutation({
    method: "adminSetUser",
    id: userId,
    payload: { status: "blocked" },
  }, "User block");
  await waitForAdminRecordState(
    userEmail,
    { includes: ["TOURNAMENT ADMIN", "· BLOCKED", "987654555 COINS"] },
    "the blocked selected user",
  );
  await assertAdminRecordState(
    otherUserEmail,
    { includes: ["PLAYER", "425000 COINS"], excludes: ["· BLOCKED"] },
    "the unrelated user after the selected user was blocked",
  );

  await resetAdminMutationCalls();
  await clickRowButton(otherUserEmail, "− COINS", "second Admin user");
  const coinPrompt = await evaluate(`(() => {
    const alert = window.__daily007AdminAlert;
    return alert ? { kind: alert.kind, title: alert.title, message: alert.message } : null;
  })()`);
  assert(
    coinPrompt?.kind === "prompt" &&
      coinPrompt.title === "Deduct coins" &&
      coinPrompt.message?.includes("Rohan Free Fire Strategist"),
    `The coin prompt did not target the selected user: ${JSON.stringify(coinPrompt)}.`,
  );
  await evaluate(`window.__daily007AdminAlert.submit("44")`);
  await assertAdminMutation({
    method: "adminAdjustCoins",
    userId: "preview-user-rohan-free-fire-2026",
    amount: -44,
    reason: "Admin deducted coins",
  }, "User coin deduction");
  await waitForAdminRecordState(
    otherUserEmail,
    { includes: ["PLAYER", "424956 COINS"], excludes: ["· BLOCKED"] },
    "the other user after their coins were deducted",
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["TOURNAMENT ADMIN", "· BLOCKED", "987654555 COINS"] },
    "the unrelated user after the other user's coins were deducted",
  );
}

async function checkAdminMutationFailureRecovery() {
  const failAndRetry = async ({
    method,
    error,
    success,
    description,
    failAction,
    assertUnchanged,
    retryAction,
  }) => {
    await resetAdminMutationCalls();
    const fixturesBeforeFailure = await evaluate(
      "window.__daily007AdminMutations?.snapshot?.() ?? null",
    );
    assert(
      fixturesBeforeFailure !== null,
      `${description} should have access to the isolated Admin fixture snapshot.`,
    );
    await failNextAdminMutation(method, error);
    await failAction();
    await assertAdminMutationFailure(error, success, description);
    const fixturesAfterFailure = await evaluate(
      "window.__daily007AdminMutations?.snapshot?.() ?? null",
    );
    assert(
      JSON.stringify(fixturesAfterFailure) === JSON.stringify(fixturesBeforeFailure),
      `${description} should leave every fake Admin fixture unchanged after rejection.`,
    );
    await assertUnchanged();
    await resetAdminMutationCalls();
    await retryAction();
  };

  await assertAdminRejectedMutationProbes();

  const registrationMarker =
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad";
  const registrationToRejectMarker =
    "Rohan Free Fire Strategist — Preview Registration To Reject";
  const approvedRegistrationMarker = "Rohan Free Fire Strategist — Preview Approved Team";
  await clickSelector('[data-testid="admin-tab-registrations"]', "Registrations tab for failure recovery");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(registrationMarker)})`,
    "the failure-recovery registration list",
  );

  await failAndRetry({
    method: "adminRegAction",
    error: "Preview failure: registration approval was rejected.",
    success: "Registration approved",
    description: "registration approval",
    failAction: () => clickRowButton(registrationMarker, "APPROVE", "pending registration"),
    assertUnchanged: async () => {
      await assertAdminRecordState(registrationMarker, { includes: ["APPROVE", "REJECT"] });
      await assertText(registrationToRejectMarker, "the unrelated pending registration");
      await clickTextLabel("APPROVED");
      await assertText(approvedRegistrationMarker, "the unrelated approved registration");
      await clickTextLabel("PENDING");
      await assertAdminRecordState(registrationMarker, { includes: ["APPROVE", "REJECT"] });
    },
    retryAction: async () => {
      await clickRowButton(registrationMarker, "APPROVE", "pending registration retry");
      await assertAdminMutation({
        method: "adminRegAction",
        id: "preview-registration-pending-long-identifier-2026",
        action: "approve",
      }, "Registration approval retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(registrationMarker)})`,
        "the retried registration approval",
      );
      await assertText(registrationToRejectMarker, "the unrelated pending registration after retry");
    },
  });

  await failAndRetry({
    method: "adminRegAction",
    error: "Preview failure: registration rejection was rejected.",
    success: "Registration rejected — coins refunded",
    description: "registration rejection",
    failAction: () => clickRowButton(registrationToRejectMarker, "REJECT", "pending registration"),
    assertUnchanged: async () => {
      await assertAdminRecordState(registrationToRejectMarker, { includes: ["APPROVE", "REJECT"] });
      await clickTextLabel("APPROVED");
      await assertText(registrationMarker, "the unrelated approved registration");
      await assertText(approvedRegistrationMarker, "the other unrelated approved registration");
      await clickTextLabel("PENDING");
      await assertAdminRecordState(registrationToRejectMarker, { includes: ["APPROVE", "REJECT"] });
    },
    retryAction: async () => {
      await clickRowButton(registrationToRejectMarker, "REJECT", "pending registration retry");
      await assertAdminMutation({
        method: "adminRegAction",
        id: "preview-registration-pending-rejection-2026",
        action: "reject",
      }, "Registration rejection retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(registrationToRejectMarker)})`,
        "the retried registration rejection",
      );
    },
  });

  await clickTextLabel("APPROVED");
  await failAndRetry({
    method: "adminDeleteRegistration",
    error: "Preview failure: registration deletion was rejected.",
    success: "Registration deleted",
    description: "registration deletion",
    failAction: () => clickRowButton(approvedRegistrationMarker, "DELETE", "approved registration"),
    assertUnchanged: async () => {
      await assertAdminRecordState(approvedRegistrationMarker, { includes: ["DELETE"] });
      await assertText(registrationMarker, "the unrelated approved registration");
    },
    retryAction: async () => {
      await clickRowButton(approvedRegistrationMarker, "DELETE", "approved registration retry");
      await assertAdminMutation({
        method: "adminDeleteRegistration",
        id: "preview-registration-approved-2026",
      }, "Registration deletion retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(approvedRegistrationMarker)}) && document.body.innerText.includes(${JSON.stringify(registrationMarker)})`,
        "the retried deletion while the other approved registration remains",
      );
    },
  });

  await clickSelector('[data-testid="admin-tab-payments"]', "Payments tab for failure recovery");
  const paymentMarker =
    "Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026";
  const paymentToRejectMarker =
    "Kavya Championship Deposit To Reject · User ID: preview-user-payment-rejection-2026";
  const pendingWithdrawalMarker =
    "Rohan International Tournament Champion · User ID: preview-user-rohan-championship-account-2026";
  const withdrawalToApproveMarker =
    "Meera Pending Payout To Approve · User ID: preview-user-withdrawal-approval-2026";
  const approvedPayoutMarker =
    "Approved Preview Payout Player · User ID: preview-user-approved-payout-2026";
  const approvedPayoutControlMarker =
    "Control Approved Payout Player · User ID: preview-user-approved-payout-control-2026";
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(paymentMarker)})`,
    "the failure-recovery payment list",
  );

  await failAndRetry({
    method: "adminPaymentAction",
    error: "Preview failure: deposit approval was rejected.",
    success: "Payment approved — coins credited",
    description: "deposit approval",
    failAction: () => clickRowButton(paymentMarker, "APPROVE", "pending deposit"),
    assertUnchanged: async () => {
      await assertAdminRecordState(paymentMarker, { includes: ["APPROVE", "REJECT"] });
      await assertText(paymentToRejectMarker, "the unrelated pending deposit");
      await assertText(pendingWithdrawalMarker, "the unrelated pending withdrawal");
    },
    retryAction: async () => {
      await clickRowButton(paymentMarker, "APPROVE", "pending deposit retry");
      await assertAdminMutation({
        method: "adminPaymentAction",
        id: "preview-payment-pending-long-reference-2026",
        action: "approve",
      }, "Deposit approval retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(paymentMarker)})`,
        "the retried deposit approval",
      );
      await assertText(paymentToRejectMarker, "the unrelated pending deposit after retry");
      await assertText(pendingWithdrawalMarker, "the unrelated pending withdrawal after retry");
    },
  });

  const paymentRejectionReason = "Retry after isolated deposit failure";
  await failAndRetry({
    method: "adminPaymentAction",
    error: "Preview failure: deposit rejection was rejected.",
    success: "Payment rejected",
    description: "deposit rejection",
    failAction: async () => {
      await clickRowButton(paymentToRejectMarker, "REJECT", "pending deposit");
      await setLastVisibleInput("Preview deposit failure reason", "deposit rejection reason");
      await clickDialogButton("Reject request", "REJECT", "deposit rejection dialog");
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(paymentToRejectMarker, { includes: ["APPROVE", "REJECT"] });
      await assertText(pendingWithdrawalMarker, "the unrelated pending withdrawal");
      await assertText(withdrawalToApproveMarker, "the other pending withdrawal");
    },
    retryAction: async () => {
      await clickRowButton(paymentToRejectMarker, "REJECT", "pending deposit retry");
      await setLastVisibleInput(paymentRejectionReason, "deposit rejection retry reason");
      await clickDialogButton("Reject request", "REJECT", "deposit rejection retry dialog");
      await assertAdminMutation({
        method: "adminPaymentAction",
        id: "preview-payment-pending-rejection-2026",
        action: "reject",
        reason: paymentRejectionReason,
      }, "Deposit rejection retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(paymentToRejectMarker)})`,
        "the retried deposit rejection",
      );
      await assertText(pendingWithdrawalMarker, "the unrelated pending withdrawal after retry");
    },
  });

  const withdrawalRejectionReason = "Retry after isolated withdrawal failure";
  await failAndRetry({
    method: "adminWithdrawalAction",
    error: "Preview failure: withdrawal rejection was rejected.",
    success: "Withdrawal rejected — coins refunded",
    description: "withdrawal rejection",
    failAction: async () => {
      await clickRowButton(pendingWithdrawalMarker, "REJECT", "pending withdrawal");
      await setLastVisibleInput("Preview withdrawal failure reason", "withdrawal rejection reason");
      await clickDialogButton("Reject request", "REJECT", "withdrawal rejection dialog");
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(pendingWithdrawalMarker, { includes: ["APPROVE", "REJECT"] });
      await assertText(withdrawalToApproveMarker, "the unrelated pending withdrawal");
    },
    retryAction: async () => {
      await clickRowButton(pendingWithdrawalMarker, "REJECT", "pending withdrawal retry");
      await setLastVisibleInput(withdrawalRejectionReason, "withdrawal rejection retry reason");
      await clickDialogButton("Reject request", "REJECT", "withdrawal rejection retry dialog");
      await assertAdminMutation({
        method: "adminWithdrawalAction",
        id: "preview-withdrawal-pending-long-reference-2026",
        action: "reject",
        reason: withdrawalRejectionReason,
      }, "Withdrawal rejection retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(pendingWithdrawalMarker)})`,
        "the retried withdrawal rejection",
      );
      await assertText(withdrawalToApproveMarker, "the unrelated pending withdrawal after retry");
    },
  });

  await failAndRetry({
    method: "adminWithdrawalAction",
    error: "Preview failure: withdrawal approval was rejected.",
    success: "Withdrawal approved",
    description: "withdrawal approval",
    failAction: () => clickRowButton(withdrawalToApproveMarker, "APPROVE", "pending withdrawal"),
    assertUnchanged: async () => {
      await assertAdminRecordState(withdrawalToApproveMarker, { includes: ["APPROVE", "REJECT"] });
      await clickTextLabel("REJECTED");
      await assertText(pendingWithdrawalMarker, "the unrelated rejected withdrawal");
      await waitForCondition(
        `document.body.innerText.includes(${JSON.stringify(`Review note: ${withdrawalRejectionReason}`)})`,
        "the unrelated rejected withdrawal and its saved reason",
      );
      await clickTextLabel("PENDING");
      await assertAdminRecordState(withdrawalToApproveMarker, { includes: ["APPROVE", "REJECT"] });
    },
    retryAction: async () => {
      await clickRowButton(withdrawalToApproveMarker, "APPROVE", "pending withdrawal retry");
      await assertAdminMutation({
        method: "adminWithdrawalAction",
        id: "preview-withdrawal-pending-approval-2026",
        action: "approve",
      }, "Withdrawal approval retry");
      await waitForCondition(
        `!document.body.innerText.includes(${JSON.stringify(withdrawalToApproveMarker)})`,
        "the retried withdrawal approval",
      );
    },
  });

  await clickTextLabel("APPROVED");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(approvedPayoutMarker)}) && document.body.innerText.includes(${JSON.stringify(approvedPayoutControlMarker)})`,
    "approved payouts for failure recovery",
  );
  await failAndRetry({
    method: "adminMarkWithdrawalPaid",
    error: "Preview failure: manual payout recording was rejected.",
    success: "Manual payout recorded",
    description: "manual payout recording",
    failAction: async () => {
      await clickRowButton(approvedPayoutMarker, "RECORD MANUAL PAYOUT SENT", "approved withdrawal");
      await clickDialogButton("Record manual payout", "MARK PAID", "manual payout confirmation");
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        approvedPayoutMarker,
        { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
        "the payout still awaiting payment",
      );
      await assertAdminRecordState(
        approvedPayoutControlMarker,
        { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
        "the unrelated approved payout",
      );
    },
    retryAction: async () => {
      await clickRowButton(approvedPayoutMarker, "RECORD MANUAL PAYOUT SENT", "approved withdrawal retry");
      await clickDialogButton("Record manual payout", "MARK PAID", "manual payout retry confirmation");
      await assertAdminMutation({
        method: "adminMarkWithdrawalPaid",
        id: "preview-withdrawal-approved-manual-payout-2026",
      }, "Manual payout retry");
      await waitForAdminRecordState(
        approvedPayoutMarker,
        { includes: ["PAID"], excludes: ["RECORD MANUAL PAYOUT SENT"] },
        "the payout after its retry",
      );
      await assertAdminRecordState(
        approvedPayoutControlMarker,
        { includes: ["MANUAL PAYOUT REQUIRED", "RECORD MANUAL PAYOUT SENT"] },
        "the unrelated payout after retry",
      );
    },
  });

  await clickSelector('[data-testid="admin-tab-wallet"]', "Wallet tab for failure recovery");
  const userEmail = "ananya.champion.with.a.long.fake.address@example.invalid";
  const otherUserEmail = "rohan.preview.player@example.invalid";
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(userEmail)})`,
    "the failure-recovery Wallet users",
  );
  await failAndRetry({
    method: "adminAdjustCoins",
    error: "Preview failure: Wallet coin addition was rejected.",
    success: "+321 coins for Ananya Daily007 Championship Champion With A Long Name",
    description: "Wallet coin addition",
    failAction: async () => {
      await clickRowButton(userEmail, "+ ADD", "Wallet user");
      await setLastVisibleInput("321", "Wallet coin amount");
      await clickDialogButton("Add coins", "ADD", "Wallet coin adjustment dialog");
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        userEmail,
        { includes: ["987654321 COINS", "+ ADD", "− DEDUCT"] },
        "the Wallet user after the failed adjustment",
      );
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["425000 COINS"] },
        "the unrelated Wallet user after the failed adjustment",
      );
    },
    retryAction: async () => {
      await clickRowButton(userEmail, "+ ADD", "Wallet user retry");
      await setLastVisibleInput("321", "Wallet coin amount retry");
      await clickDialogButton("Add coins", "ADD", "Wallet coin adjustment retry dialog");
      await assertAdminMutation({
        method: "adminAdjustCoins",
        userId: "preview-user-ananya-championship-2026",
        amount: 321,
        reason: "Admin added coins",
      }, "Wallet coin addition retry");
      await waitForAdminRecordState(userEmail, { includes: ["987654642 COINS"] });
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["425000 COINS"] },
        "the unrelated Wallet user after retry",
      );
    },
  });

  await clickSelector('[data-testid="admin-tab-users"]', "Users tab for failure recovery");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(userEmail)})`,
    "the failure-recovery Admin users",
  );
  const userId = "preview-user-ananya-championship-2026";
  const otherUserId = "preview-user-rohan-free-fire-2026";
  await failAndRetry({
    method: "adminAdjustCoins",
    error: "Preview failure: user coin deduction was rejected.",
    success: "Coins updated",
    description: "Admin Users coin deduction",
    failAction: async () => {
      await clickRowButton(userEmail, "− COINS", "Admin user");
      const prompt = await evaluate(`(() => {
        const alert = window.__daily007AdminAlert;
        return alert ? { kind: alert.kind, title: alert.title } : null;
      })()`);
      assert(
        prompt?.kind === "prompt" && prompt.title === "Deduct coins",
        `The failed user coin change did not open its prompt: ${JSON.stringify(prompt)}.`,
      );
      await evaluate(`window.__daily007AdminAlert.submit("44")`);
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "987654642 COINS"], excludes: ["· BLOCKED"] },
        "the Admin user after failed coin deduction",
      );
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["TOURNAMENT ADMIN", "· BLOCKED", "425000 COINS"] },
        "the unrelated Admin user after failed coin deduction",
      );
    },
    retryAction: async () => {
      await clickRowButton(userEmail, "− COINS", "Admin user retry");
      await evaluate(`window.__daily007AdminAlert.submit("44")`);
      await assertAdminMutation({
        method: "adminAdjustCoins",
        userId,
        amount: -44,
        reason: "Admin deducted coins",
      }, "Admin Users coin deduction retry");
      await waitForAdminRecordState(userEmail, { includes: ["987654598 COINS"] });
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["425000 COINS"] },
        "the unrelated Admin user after coin deduction retry",
      );
    },
  });

  await failAndRetry({
    method: "adminSetUserRole",
    error: "Preview failure: Admin role change was rejected.",
    success: "Rohan Free Fire Strategist is now a player",
    description: "Admin role change",
    failAction: async () => {
      await clickSelector(`[data-testid="change-user-role-${otherUserId}"]`, "role change");
      await clickSelector('[data-testid="confirm-tournament-admin-change"]', "confirm role change");
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["TOURNAMENT ADMIN", "· BLOCKED", "425000 COINS"] },
        "the user after failed role change",
      );
      await assertAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "987654598 COINS"], excludes: ["· BLOCKED"] },
        "the unrelated user after failed role change",
      );
    },
    retryAction: async () => {
      await clickSelector(`[data-testid="change-user-role-${otherUserId}"]`, "role change retry");
      await clickSelector('[data-testid="confirm-tournament-admin-change"]', "confirm role change retry");
      await assertAdminMutation({
        method: "adminSetUserRole",
        id: otherUserId,
        role: "user",
      }, "Admin role change retry");
      await waitForAdminRecordState(
        otherUserEmail,
        { includes: ["PLAYER", "· BLOCKED"] },
        "the user after role change retry",
      );
      await assertAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "987654598 COINS"], excludes: ["· BLOCKED"] },
        "the unrelated user after role change retry",
      );
    },
  });

  await failAndRetry({
    method: "adminSetUser",
    error: "Preview failure: unblock request was rejected.",
    success: "Rohan Free Fire Strategist unblocked",
    description: "Admin user unblock",
    failAction: async () => {
      await clickRowButton(otherUserEmail, "UNBLOCK", "blocked Admin user");
      await evaluate(`window.__daily007AdminAlert.choose("Unblock")`);
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["PLAYER", "· BLOCKED"] },
        "the user after failed unblock",
      );
      await assertAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "987654598 COINS"], excludes: ["· BLOCKED"] },
        "the unrelated user after failed unblock",
      );
    },
    retryAction: async () => {
      await clickRowButton(otherUserEmail, "UNBLOCK", "blocked Admin user retry");
      await evaluate(`window.__daily007AdminAlert.choose("Unblock")`);
      await assertAdminMutation({
        method: "adminSetUser",
        id: otherUserId,
        payload: { status: "active" },
      }, "Admin user unblock retry");
      await waitForAdminRecordState(
        otherUserEmail,
        { includes: ["PLAYER", "425000 COINS"], excludes: ["· BLOCKED"] },
        "the user after unblock retry",
      );
    },
  });

  await failAndRetry({
    method: "adminSetUser",
    error: "Preview failure: block request was rejected.",
    success: "Ananya Daily007 Championship Champion With A Long Name blocked",
    description: "Admin user block",
    failAction: async () => {
      await clickRowButton(userEmail, "BLOCK", "active Admin user");
      await evaluate(`window.__daily007AdminAlert.choose("Block")`);
    },
    assertUnchanged: async () => {
      await assertAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "987654598 COINS"], excludes: ["· BLOCKED"] },
        "the user after failed block",
      );
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["PLAYER", "425000 COINS"], excludes: ["· BLOCKED"] },
        "the unrelated user after failed block",
      );
    },
    retryAction: async () => {
      await clickRowButton(userEmail, "BLOCK", "active Admin user retry");
      await evaluate(`window.__daily007AdminAlert.choose("Block")`);
      await assertAdminMutation({
        method: "adminSetUser",
        id: userId,
        payload: { status: "blocked" },
      }, "Admin user block retry");
      await waitForAdminRecordState(
        userEmail,
        { includes: ["PLAYER", "· BLOCKED", "987654598 COINS"] },
        "the user after block retry",
      );
      await assertAdminRecordState(
        otherUserEmail,
        { includes: ["PLAYER", "425000 COINS"], excludes: ["· BLOCKED"] },
        "the unrelated user after block retry",
      );
    },
  });
}

async function checkTournamentStates(width, { largeText = false, landscape = false } = {}) {
  await openAdminTab("tournaments", "Tournaments", { requireReachability: landscape });
  await assertAdminTouchTargetGroup(
    '[data-testid^="admin-tournament-tab-"]',
    "Tournament status filters",
    width,
    { expectedCount: 3 },
  );
  if (largeText || landscape) await assertTournamentStatusTabsFit(width);
  if (landscape) {
    for (const status of ["upcoming", "ongoing", "completed"]) {
      await assertReachableControl(
        `[data-testid="admin-tournament-tab-${status}"]`,
        `${status} tournament tab`,
      );
    }
    await assertReachableControl(
      '[data-testid="admin-tournament-create-toggle"]',
      "New tournament control",
    );
    await tapSelector('[data-testid="admin-tournament-create-toggle"]', "New tournament control");
  } else {
    await clickButton("NEW");
  }

  await assertText("CREATE TOURNAMENT");
  await assertText("GAME MODE");
  await assertText("FORMAT");
  await clickTextLabel("Lone Wolf");
  for (const [selector, label] of [
    ['[placeholder="Tournament name *"]', "Tournament name field"],
    ['[placeholder="Date (YYYY-MM-DD, IST) *"]', "Tournament date field"],
    ['[placeholder="Entry coins *"]', "Tournament entry-fee field"],
    ['[placeholder="Prize pool"]', "Tournament prize-pool field"],
    ['[placeholder="Optional custom banner image URL (HTTPS)"]', "Tournament banner URL field"],
    ['[placeholder="Rules (one per line)"]', "Tournament rules field"],
    ['[placeholder="Prize distribution (e.g. 1st: 500 coins)"]', "Prize distribution field"],
  ]) {
    await assertHorizontalFit(selector, label, width);
  }
  if (landscape) {
    await assertReachableControl('[placeholder="Tournament name *"]', "Tournament name field");
    await assertReachableControl(
      '[data-testid="admin-tournament-create-submit"]',
      "Tournament creation submit control",
    );
  }
  if (largeText || landscape) {
    await assertVisibleAdminControlsFit(width, "Tournament creation form");
    await assertPageHasNoHorizontalOverflow(width, "Tournament creation form");
    await assertVisibleTextFits(
      '[data-testid="admin-tournament-create-form"]',
      width,
      "Tournament creation form",
    );
  }
  if (landscape) {
    await assertReachableControl(
      '[data-testid="admin-tournament-create-toggle"]',
      "Close tournament creation control",
    );
    await tapSelector('[data-testid="admin-tournament-create-toggle"]', "Close tournament creation control");
  } else {
    await clickButton("CLOSE");
  }
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="manage-room-preview-upcoming"]'))`,
    "upcoming tournament fixture",
  );
  await assertTournamentStatusFilter("upcoming");

  if (landscape) {
    await assertReachableControl(
      '[data-testid="manage-room-preview-upcoming"]',
      "Upcoming tournament room setup action",
    );
  }
  await activateSelector(
    '[data-testid="manage-room-preview-upcoming"]',
    "room setup action",
    landscape,
  );
  const roomPanel = await evaluate(
    "Boolean(document.querySelector('[data-testid=\"inline-room-management-preview-upcoming\"]'))",
  );
  assert(roomPanel, `Room setup did not open at ${width}px.`);
  await assertText("ROOM SETUP");
  await assertText("ROOM ID");
  await assertText("ROOM PASSWORD");
  await assertHorizontalFit('[placeholder="Room ID"]', "Room ID field", width);
  await assertHorizontalFit('[placeholder="Room Password"]', "Room password field", width);
  if (landscape) {
    await assertReachableControl('[placeholder="Room ID"]', "Room ID field");
    await assertReachableControl('[placeholder="Room Password"]', "Room password field");
    await assertReachableControl(
      '[data-testid="save-room-preview-upcoming"]',
      "Save room details control",
      { allowDisabled: true },
    );
  }
  if (largeText || landscape) {
    await assertVisibleAdminControlsFit(width, "Room setup");
    await assertPageHasNoHorizontalOverflow(width, "Room setup");
    await assertVisibleTextFits(
      '[data-testid="inline-room-management-preview-upcoming"]',
      width,
      "Room setup",
    );
  }

  if (landscape) {
    await assertReachableControl('[data-testid="admin-tournament-tab-ongoing"]', "Ongoing tournament tab");
  }
  await activateSelector(
    '[data-testid="admin-tournament-tab-ongoing"]',
    "Ongoing tournament filter",
    landscape,
  );
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="finish-tournament-preview-ongoing"]'))`,
    "ongoing tournament fixture",
  );
  await assertTournamentStatusFilter("ongoing");
  if (landscape) {
    await assertReachableControl(
      '[data-testid="finish-tournament-preview-ongoing"]',
      "Ongoing tournament result entry action",
    );
  }
  await activateSelector(
    '[data-testid="finish-tournament-preview-ongoing"]',
    "result entry action",
    landscape,
  );
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
  await assertHorizontalFit('[data-testid="result-rank-preview-ongoing"]', "Result rank field", width);
  await assertHorizontalFit('[data-testid="result-kills-preview-ongoing"]', "Result kills field", width);
  await assertHorizontalFit('[data-testid="inline-results-entry-preview-ongoing"]', "Result entry panel", width);
  if (landscape) {
    await assertReachableControl(
      '[data-testid^="result-registration-"]',
      "Approved player choice in result entry",
    );
    await assertReachableControl('[data-testid="result-rank-preview-ongoing"]', "Result rank field");
    await assertReachableControl('[data-testid="result-kills-preview-ongoing"]', "Result kills field");
    await assertReachableControl(
      '[data-testid="publish-result-preview-ongoing"]',
      "Publish result control",
    );
  }
  if (largeText || landscape) {
    await assertVisibleAdminControlsFit(width, "Result entry");
    await assertPageHasNoHorizontalOverflow(width, "Result entry");
    await assertVisibleTextFits(
      '[data-testid="inline-results-entry-preview-ongoing"]',
      width,
      "Result entry",
    );
  }

  if (landscape) {
    await assertReachableControl('[data-testid="admin-tournament-tab-completed"]', "Completed tournament tab");
  }
  await activateSelector(
    '[data-testid="admin-tournament-tab-completed"]',
    "Completed tournament filter",
    landscape,
  );
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="completed-result-log-preview-completed"]'))`,
    "completed tournament fixture",
  );
  await assertTournamentStatusFilter("completed");
  const completedPanel = await evaluate(
    "Boolean(document.querySelector('[data-testid=\"completed-result-log-preview-completed\"]'))",
  );
  assert(completedPanel, `Completed-result details did not open at ${width}px.`);
  await assertText("WINNER & RESULT LOG");
  await assertText(
    largeText
      ? "WINNER · Daily007 International Free Fire Championship Winner"
      : "WINNER · Preview Champion",
  );
  await assertText("PRIZE SETTLED · 300 COINS");
  await assertText(
    largeText
      ? "#1 Daily007 International Free Fire Championship Winner · Daily007 Grand Finals Championship Squad · 8 kills · 300 coins"
      : "#1 Preview Champion · 8 kills · 300 coins",
  );
  if (largeText || landscape) {
    await assertVisibleAdminControlsFit(width, "Completed-result details");
    await assertPageHasNoHorizontalOverflow(width, "Completed-result details");
    await assertVisibleTextFits(
      '[data-testid="completed-result-log-preview-completed"]',
      width,
      "Completed-result details",
    );
  }
  await assertHorizontalFit(
    '[data-testid="completed-result-log-preview-completed"]',
    "Completed-result details",
    width,
  );
}

async function checkTournamentInitialLoadFailure() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Player initial-load preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('Could not load tournaments: Initial tournament request failed')",
    "the first Player request to fail with the initial-load error",
  );
  assert(
    !await evaluate("document.body.innerText.includes('Could not refresh tournaments')"),
    "A Player error before the first successful load must not be labeled as a refresh failure.",
  );
  assert(
    !await evaluate("document.body.innerText.includes('IST Start Boundary')"),
    "The failed first Player load must not show a tournament card.",
  );

  const firstLoadErrorAccessibility = await evaluate(`(() => {
    const container = document.querySelector('[data-testid="player-tournament-load-error"]');
    const liveRegion = container?.querySelector('[aria-live]');
    return {
      liveRegion: liveRegion?.getAttribute('aria-live') ?? null,
      label: liveRegion?.getAttribute('aria-label') ?? null,
      announcements: window.__daily007TournamentResume.getLoadAnnouncementEvents(),
    };
  })()`);
  assert(
    firstLoadErrorAccessibility.liveRegion === 'polite',
    `The initial-load error must use a polite TalkBack live region: ${JSON.stringify(firstLoadErrorAccessibility)}.`,
  );
  assert(
    firstLoadErrorAccessibility.label === 'Could not load tournaments: Initial tournament request failed',
    `The initial-load error must have a clear accessible label: ${JSON.stringify(firstLoadErrorAccessibility)}.`,
  );
  assert(
    JSON.stringify(firstLoadErrorAccessibility.announcements) === JSON.stringify([{
      testID: 'player-tournament-load-error',
      text: 'Could not load tournaments: Initial tournament request failed',
    }]),
    `The initial error should produce one announcement: ${JSON.stringify(firstLoadErrorAccessibility.announcements)}.`,
  );
  assert(
    await evaluate('window.__daily007TournamentResume.focusUpcomingTabAndRemember()'),
    'The Upcoming tab must be focusable before testing recovery focus stability.',
  );

  const readsAfterFailure = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate(`window.__daily007TournamentResume.failNextTournamentRead("Initial tournament request failed")`);
  await evaluate("window.__daily007TournamentResume.retryAfterInitialLoadFailure()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsAfterFailure} && document.body.innerText.includes('Could not load tournaments: Initial tournament request failed')`,
    "a repeated failed first-load retry",
  );
  const repeatedFailureAnnouncements = await evaluate(
    'window.__daily007TournamentResume.getLoadAnnouncementEvents()',
  );
  assert(
    repeatedFailureAnnouncements.filter((event) => event.testID === 'player-tournament-load-error').length === 1,
    `The unchanged initial-load error must not be announced repeatedly: ${JSON.stringify(repeatedFailureAnnouncements)}.`,
  );
  assert(
    await evaluate('window.__daily007TournamentResume.focusUnchanged()'),
    'A repeated Player load failure must not move focus away from the Upcoming tab.',
  );

  const readsAfterRepeatedFailure = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.retryAfterInitialLoadFailure()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsAfterRepeatedFailure} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Could not load tournaments: Initial tournament request failed') && document.querySelector('[data-testid="player-tournament-load-announcement"]')?.getAttribute('aria-live') === 'polite'`,
    "a successful Player retry to show the tournament and announce recovery",
  );
  await assertText("IST Start Boundary", "the Player tournament after the successful retry");
  assert(
    !await evaluate("document.body.innerText.includes('Could not load tournaments')"),
    "A successful Player load must clear the initial-load error.",
  );
  const recoveryAnnouncements = await evaluate(
    'window.__daily007TournamentResume.getLoadAnnouncementEvents()',
  );
  assert(
    JSON.stringify(recoveryAnnouncements) === JSON.stringify([
      {
        testID: 'player-tournament-load-error',
        text: 'Could not load tournaments: Initial tournament request failed',
      },
      {
        testID: 'player-tournament-load-announcement',
        text: 'Tournaments loaded.',
      },
    ]),
    `Recovery should be announced once after cards appear: ${JSON.stringify(recoveryAnnouncements)}.`,
  );
  assert(
    await evaluate('window.__daily007TournamentResume.focusUnchanged()'),
    'Successful recovery must not move focus away from the Upcoming tab.',
  );

  const readsAfterRecovery = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.retryAfterInitialLoadFailure()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsAfterRecovery} && document.body.innerText.includes('IST Start Boundary')`,
    "a later successful Player refresh",
  );
  const repeatedRecoveryAnnouncements = await evaluate(
    'window.__daily007TournamentResume.getLoadAnnouncementEvents()',
  );
  assert(
    JSON.stringify(repeatedRecoveryAnnouncements) === JSON.stringify(recoveryAnnouncements),
    `A later successful refresh must not repeat the recovery announcement: ${JSON.stringify(repeatedRecoveryAnnouncements)}.`,
  );
  assert(
    await evaluate('window.__daily007TournamentResume.focusUnchanged()'),
    'A later successful Player refresh must not move focus away from the Upcoming tab.',
  );
}

async function checkRegistrationInitialLoadFailure() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Player registration-failure preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && window.__daily007TournamentResume.getMyRegistrationReadCount() > 0 && document.body.innerText.includes('Could not confirm which tournaments you have joined: Initial registration request failed')",
    "the successful tournament list and failed first registration lookup",
  );
  await assertText("IST Start Boundary", "the tournament card after registration lookup fails");
  await assertText(
    "ENTRY STATUS UNKNOWN · TAP TO CHECK →",
    "the card's safe status while joined state is unknown",
  );
  assert(
    !await evaluate("document.body.innerText.includes('JOIN NOW')"),
    "The Player list must not offer a join action while joined status is unknown.",
  );
  assert(
    await evaluate("Boolean(document.querySelector('[data-testid=\"player-tournament-list\"]'))"),
    "The Player tournament list should remain mounted after only the registration lookup fails.",
  );

  const readsAfterFailure = await evaluate(`({
    tournaments: window.__daily007TournamentResume.getTournamentReadCount(),
    registrations: window.__daily007TournamentResume.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007TournamentResume.retryAfterInitialLoadFailure()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsAfterFailure.tournaments} &&
      window.__daily007TournamentResume.getMyRegistrationReadCount() > ${readsAfterFailure.registrations} &&
      document.body.innerText.includes('Joined') &&
      !document.body.innerText.includes('ENTRY STATUS UNKNOWN') &&
      !document.body.innerText.includes('Could not confirm which tournaments you have joined')`,
    "a later successful registration lookup to confirm joined status",
  );
  await assertText("IST Start Boundary", "the tournament card after registration recovery");
  assert(
    await evaluate("Boolean(document.querySelector('[data-testid=\"player-tournament-list\"]'))"),
    "The tournament list must remain mounted after registration recovery.",
  );
}

async function checkTournamentDetailRegistrationFailure() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the tournament-detail registration-failure preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentDetailReadCount() > 0 && window.__daily007TournamentResume.getMyRegistrationReadCount() > 0 && document.body.innerText.includes('ENTRY STATUS UNKNOWN')",
    "tournament details to remain visible when the initial registration lookup fails",
  );
  await assertText("IST Start Boundary", "the tournament details after registration lookup fails");
  await assertText("MATCH INFO", "the loaded tournament details after registration lookup fails");
  await assertText(
    "We couldn’t confirm whether you’ve joined. Check your entry status again before trying to join.",
    "the explanation that joined status is unknown",
  );
  assert(
    await evaluate("Boolean(document.querySelector('[data-testid=\"tournament-entry-status-unknown\"]'))"),
    "The detail screen must expose a distinct unknown entry-status state.",
  );
  assert(
    !await evaluate("document.body.innerText.includes('JOIN NOW')"),
    "The detail screen must not offer joining until entry status is verified.",
  );

  const readsAfterFailure = await evaluate(`({
    tournaments: window.__daily007TournamentResume.getTournamentDetailReadCount(),
    registrations: window.__daily007TournamentResume.getMyRegistrationReadCount(),
  })`);
  await clickSelector(
    '[data-testid="tournament-entry-status-retry"]',
    "the tournament entry-status retry action",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentDetailReadCount() > ${readsAfterFailure.tournaments} &&
      window.__daily007TournamentResume.getMyRegistrationReadCount() > ${readsAfterFailure.registrations} &&
      document.body.innerText.includes('Joined') &&
      !document.body.innerText.includes('ENTRY STATUS UNKNOWN')`,
    "the successful retry to update joined status without hiding details",
  );
  await assertText("IST Start Boundary", "the tournament details after entry-status recovery");
  assert(
    await evaluate("Boolean(document.querySelector('[data-testid=\"tournament-entry-status-unknown\"]')) === false"),
    "The unknown status guidance must clear after registration status is verified.",
  );
}

async function checkAdminInitialLoadFailure({ largeText = false } = {}) {
  const recoveredTournamentName = largeText
    ? "Daily007 International Free Fire Championship Grand Finals"
    : "IST Start Boundary";
  if (largeText) {
    await setViewport(
      390,
      1.5,
      "tournament-resume-preview.html?admin-initial-load-failure-only=1",
    );
    assert(
      await evaluate("window.__daily007LargeTextScale === 1.5"),
      "The Admin recovery preview must use Android's 1.5× text scale.",
    );
  }

  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Admin first-load failure preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('Could not load tournaments: Initial Admin tournament request failed') && Boolean(document.querySelector('[data-testid=\"admin-tournament-refresh-retry\"]'))",
    "the first Admin request to fail with a visible load error and Retry control",
  );
  await assertText("TOURNAMENTS", "the Admin tournament screen after its initial request fails");
  await assertText("RETRY", "the Admin initial-load recovery action");
  assert(
    !await evaluate(`document.body.innerText.includes(${JSON.stringify(recoveredTournamentName)})`),
    "An Admin initial-load failure must not show a tournament card before data loads.",
  );
  if (largeText) {
    await assertVisibleTextFits(
      '[data-testid="admin-tournament-load-error"]',
      390,
      "The Admin tournament error at 1.5× text",
    );
    await assertReachableControl(
      '[data-testid="admin-tournament-refresh-retry"]',
      "The Admin Retry control at 1.5× text",
    );
    const retryHeight = await evaluate(
      "document.querySelector('[data-testid=\"admin-tournament-refresh-retry\"]')?.getBoundingClientRect().height ?? 0",
    );
    assert(
      retryHeight >= minimumAndroidTouchTarget,
      `The Admin Retry control is smaller than the ${minimumAndroidTouchTarget}px Android touch target at 1.5× text (height=${retryHeight}px).`,
    );
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  }
  const retryVisible = await evaluate(`(() => {
    const retry = document.querySelector('[data-testid="admin-tournament-refresh-retry"]');
    if (!retry) return false;
    const rect = retry.getBoundingClientRect();
    const style = getComputedStyle(retry);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !retry.disabled;
  })()`);
  assert(retryVisible, "The Admin initial-load Retry control must be visible and enabled.");
  const initialLoadAccessibility = await evaluate(`(() => {
    const error = document.querySelector('[data-testid="admin-tournament-load-error"]');
    const liveRegion = error?.querySelector('[aria-live]');
    const retry = document.querySelector('[data-testid="admin-tournament-refresh-retry"]');
    return {
      errorText: error?.innerText ?? null,
      liveRegion: liveRegion?.getAttribute('aria-live') ?? null,
      retryRole: retry?.getAttribute('role') ?? null,
      retryLabel: retry?.getAttribute('aria-label') ?? null,
    };
  })()`);
  assert(
    initialLoadAccessibility.errorText?.includes(
      "Could not load tournaments: Initial Admin tournament request failed",
    ) && initialLoadAccessibility.liveRegion === "polite",
    `The initial Admin error must be exposed as a polite live announcement: ${JSON.stringify(initialLoadAccessibility)}.`,
  );
  assert(
    initialLoadAccessibility.retryRole === "button"
      && initialLoadAccessibility.retryLabel === "Retry loading tournaments",
    `The initial-load recovery action must be announced as a button with a clear purpose: ${JSON.stringify(initialLoadAccessibility)}.`,
  );

  const readsBeforeRetry = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  const secondFailureMessage =
    "The tournament list could not be refreshed because the connection to the Daily007 service was interrupted. Check your internet connection and retry.";
  if (largeText) {
    await evaluate(
      `window.__daily007TournamentResume.failNextTournamentRead(${JSON.stringify(secondFailureMessage)})`,
    );
  }
  if (largeText) {
    await tapSelector(
      '[data-testid="admin-tournament-refresh-retry"]',
      "Admin initial-load Retry at 1.5× text",
    );
  } else {
    await clickSelector(
      '[data-testid="admin-tournament-refresh-retry"]',
      "Admin initial-load Retry",
    );
  }
  if (largeText) {
    await waitForCondition(
      `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRetry} && document.body.innerText.includes(${JSON.stringify(`Could not load tournaments: ${secondFailureMessage}`)}) && !document.body.innerText.includes('Initial Admin tournament request failed')`,
      "the first Admin retry to fail with its updated, longer error",
    );
    await assertVisibleTextFits(
      '[data-testid="admin-tournament-load-error"]',
      390,
      "The updated Admin tournament error at 1.5× text",
    );
    await assertReachableControl(
      '[data-testid="admin-tournament-refresh-retry"]',
      "The Admin Retry control after its first retry fails at 1.5× text",
    );
    const updatedFailureRetryState = await evaluate(`(() => {
      const retry = document.querySelector('[data-testid="admin-tournament-refresh-retry"]');
      return retry ? {
        disabled: retry.disabled,
        ariaDisabled: retry.getAttribute('aria-disabled'),
        height: retry.getBoundingClientRect().height,
      } : null;
    })()`);
    assert(
      updatedFailureRetryState?.disabled === false
        && updatedFailureRetryState?.ariaDisabled !== "true"
        && updatedFailureRetryState?.height >= minimumAndroidTouchTarget,
      `After its first retry fails, Admin Retry must remain enabled and at least ${minimumAndroidTouchTarget}px tall at 1.5× text: ${JSON.stringify(updatedFailureRetryState)}.`,
    );
    await tapSelector(
      '[data-testid="admin-tournament-refresh-retry"]',
      "Admin Retry again after its first retry fails at 1.5× text",
    );
  }
  await waitForCondition(
    largeText
      ? `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRetry + 1} && document.body.innerText.includes(${JSON.stringify(recoveredTournamentName)}) && !document.body.innerText.includes('Could not load tournaments') && !document.body.innerText.includes('Could not refresh tournaments')`
      : `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRetry} && document.body.innerText.includes(${JSON.stringify(recoveredTournamentName)}) && !document.body.innerText.includes('Could not load tournaments') && !document.body.innerText.includes('Could not refresh tournaments')`,
    "a successful Admin retry to show tournament cards and clear the initial-load error",
  );
  await assertText(recoveredTournamentName, "the Admin tournament after initial-load recovery");
  assert(
    !await evaluate("document.body.innerText.includes('Could not load tournaments')"),
    "A successful Admin retry must clear the initial-load error.",
  );
  assert(
    !await evaluate("Boolean(document.querySelector('[data-testid=\"admin-tournament-load-error\"]'))")
      && !await evaluate("Boolean(document.querySelector('[data-testid=\"admin-tournament-refresh-retry\"]'))"),
    "A successful Admin retry must remove both the stale error announcement and its recovery action.",
  );
}

async function checkAdminRetryConcurrency() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Admin Retry concurrency preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('Could not load tournaments: Initial Admin tournament request failed') && Boolean(document.querySelector('[data-testid=\"admin-tournament-refresh-retry\"]'))",
    "the Admin initial-load error and Retry control",
  );
  assert(
    (await evaluate("window.__daily007TournamentResume.getLoadAnnouncementEvents()"))
      .filter((event) => event.testID === "admin-tournament-list-recovery-announcement").length === 0,
    "An initial load failure must not announce a successful tournament recovery.",
  );

  const readsBeforeRetry = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.deferNextTournamentRead()");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const retrySelector = '[data-testid="admin-tournament-refresh-retry"]';
  await tapSelector(retrySelector, "Admin Retry control");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRetry + 1}`,
    "the held Admin retry request to start",
  );
  const pendingRetryState = await evaluate(`(() => {
    const retry = document.querySelector('${retrySelector}');
    return retry ? {
      disabledProperty: retry.disabled,
      disabledAttribute: retry.getAttribute('disabled'),
      ariaDisabled: retry.getAttribute('aria-disabled'),
      accessibilityLabel: retry.getAttribute('aria-label'),
      hasProgressIndicator: Boolean(retry.querySelector('[role="progressbar"]')),
      role: retry.getAttribute('role'),
      html: retry.outerHTML,
    } : null;
  })()`);
  assert(
    pendingRetryState?.disabledProperty === true
      && pendingRetryState?.ariaDisabled === "true"
      && pendingRetryState?.accessibilityLabel === "Retry loading tournaments"
      && pendingRetryState?.hasProgressIndicator === true,
    `The held Admin retry should expose its clear label and disabled state and show a progress indicator: ${JSON.stringify(pendingRetryState)}`,
  );
  assert(
    await evaluate("document.body.innerText.split('Could not load tournaments: Initial Admin tournament request failed').length - 1") === 1,
    "The pending retry must leave one clear initial-load error visible.",
  );

  await tapSelector(retrySelector, "disabled Admin Retry control during the held request");
  await tapSelector(retrySelector, "disabled Admin Retry control during the held request");
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBeforeRetry + 1,
    "Repeated taps while the Admin retry is pending must not send duplicate tournament requests.",
  );
  assert(
    await evaluate(`(() => {
      const retry = document.querySelector('${retrySelector}');
      return retry?.disabled === true
        && retry?.getAttribute('aria-disabled') === 'true'
        && Boolean(retry.querySelector('[role="progressbar"]'));
    })()`),
    "The Admin Retry control must remain disabled with its busy indicator until its request settles.",
  );

  const heldReadFailed = await evaluate(
    "window.__daily007TournamentResume.failDeferredTournamentRead('Held retry request failed')",
  );
  assert(heldReadFailed, "The test must release the held Admin request with a failure.");
  await waitForCondition(
    `document.body.innerText.includes('Could not load tournaments: Held retry request failed') && !document.body.innerText.includes('Could not load tournaments: Initial Admin tournament request failed') && document.querySelector('${retrySelector}')?.disabled === false && !document.querySelector('${retrySelector}')?.querySelector('[role="progressbar"]')`,
    "the failed Admin request to show one new error and re-enable Retry",
  );
  const recoveredRetryState = await evaluate(`(() => {
    const retry = document.querySelector('${retrySelector}');
    return retry ? {
      disabledProperty: retry.disabled,
      ariaDisabled: retry.getAttribute('aria-disabled'),
      hasProgressIndicator: Boolean(retry.querySelector('[role="progressbar"]')),
    } : null;
  })()`);
  assert(
    recoveredRetryState?.disabledProperty === false
      && recoveredRetryState?.ariaDisabled !== "true"
      && recoveredRetryState?.hasProgressIndicator === false,
    `After a failed retry, the control must be available and no longer busy: ${JSON.stringify(recoveredRetryState)}`,
  );
  assert(
    await evaluate("document.body.innerText.split('Could not load tournaments:').length - 1") === 1,
    "A failed Admin retry must leave exactly one clear load error.",
  );
  assert(
    (await evaluate("window.__daily007TournamentResume.getLoadAnnouncementEvents()"))
      .filter((event) => event.testID === "admin-tournament-list-recovery-announcement").length === 0,
    "A failed Admin retry must not announce a successful tournament recovery.",
  );

  const readsBeforeRecovery = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await tapSelector(retrySelector, "re-enabled Admin Retry control");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRecovery} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Could not load tournaments') && document.querySelector('[data-testid="admin-tournament-list-recovery-announcement"]')?.textContent?.trim() === 'Tournaments loaded.'`,
    "a subsequent Admin retry to load the tournament and clear the error",
  );
  const recoveryAnnouncementEvents = await evaluate(
    "window.__daily007TournamentResume.getLoadAnnouncementEvents().filter((event) => event.testID === 'admin-tournament-list-recovery-announcement')",
  );
  assert(
    recoveryAnnouncementEvents.length === 1
      && recoveryAnnouncementEvents[0]?.text === "Tournaments loaded.",
    `A successful retry after a list error must announce the recovery once: ${JSON.stringify(recoveryAnnouncementEvents)}.`,
  );
  await assertText("IST Start Boundary", "the Admin tournament after retry becomes reusable");
  const readsBeforeRoutineRefresh = await evaluate(
    "window.__daily007TournamentResume.getTournamentReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.resumeCurrentList()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRoutineRefresh} && document.body.innerText.includes('IST Start Boundary')`,
    "a routine Admin tournament refresh after recovery",
  );
  await delay(100);
  const announcementsAfterRoutineRefresh = await evaluate(
    "window.__daily007TournamentResume.getLoadAnnouncementEvents().filter((event) => event.testID === 'admin-tournament-list-recovery-announcement')",
  );
  assert(
    announcementsAfterRoutineRefresh.length === 1,
    `A routine Admin tournament refresh must not repeat the recovery announcement: ${JSON.stringify(announcementsAfterRoutineRefresh)}.`,
  );
}

async function checkAdminResultEntryRetry() {
  const tournamentId = "result-entry-retry-active";
  const panelSelector = `[data-testid="inline-results-entry-${tournamentId}"]`;
  const openSelector = `[data-testid="finish-tournament-${tournamentId}"]`;
  const retrySelector = `[data-testid="retry-approved-registrations-${tournamentId}"]`;
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Result Entry retry preview to initialize",
  );
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "the Ongoing tournaments tab");
  await waitForCondition(
    `document.querySelector(${JSON.stringify(openSelector)}) &&
      document.body.innerText.includes("Other Ongoing Match")`,
    "both ongoing tournament actions",
  );
  await clickSelector(openSelector, "Result Entry for the active tournament");
  await waitForCondition(
    "window.__daily007TournamentResume.getApprovedRegistrationRequests().length === 1",
    "the initial approved-registration request to fail while Result Entry stays open",
  );
  const initialFailureState = await evaluate(`(() => ({
    panelOpen: Boolean(document.querySelector(${JSON.stringify(panelSelector)})),
    errorVisible: document.body.innerText.includes("Initial approved registrations request failed."),
    guidanceVisible: document.body.innerText.includes("Approved registrations could not be loaded. Retry here. If the problem continues, close and reopen this panel."),
    retryVisible: Boolean(document.querySelector(${JSON.stringify(retrySelector)})),
  }))()`);
  assert(
    initialFailureState.panelOpen && initialFailureState.errorVisible &&
      initialFailureState.guidanceVisible && initialFailureState.retryVisible,
    `Opening Result Entry should show the failed request and retry control without closing the panel: ${JSON.stringify(initialFailureState)}.`,
  );
  assert(
    await evaluate(`document.querySelector('${retrySelector}')?.disabled === false`),
    "The retry control should be enabled after the initial request fails.",
  );

  await clickSelector(retrySelector, "Retry approved registrations");
  await waitForCondition(
    `window.__daily007TournamentResume.getApprovedRegistrationRequests().length === 2 &&
      document.body.innerText.includes("Retrying approved registrations…")`,
    "the retry to remain pending with Result Entry open",
  );
  const progressState = await evaluate(`(() => {
    const button = document.querySelector('${retrySelector}');
    return {
      panelOpen: Boolean(document.querySelector(${JSON.stringify(panelSelector)})),
      text: button?.textContent?.trim() ?? "",
      disabled: button?.disabled ?? false,
      ariaDisabled: button?.getAttribute("aria-disabled"),
      accessibleLabel: button?.getAttribute("aria-label"),
      hasLoadingIndicator: (button?.childElementCount ?? 0) > 0,
    };
  })()`);
  assert(
    progressState.panelOpen &&
      progressState.disabled &&
      progressState.ariaDisabled === "true" &&
      progressState.accessibleLabel === "Retry approved registrations" &&
      progressState.hasLoadingIndicator,
    `Retry progress must be visible and the control unavailable while loading: ${JSON.stringify(progressState)}.`,
  );
  await clickSelector(retrySelector, "the disabled retry control during the pending request");
  assert(
    (await evaluate("window.__daily007TournamentResume.getApprovedRegistrationRequests().length")) === 2,
    "Repeated taps while Retry is pending must not issue another request.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.releaseApprovedRegistrationRetry()"),
    "The pending successful approved-registration response should be released.",
  );
  await waitForCondition(
    `document.body.innerText.includes("Retry Fixture Player") &&
      document.body.innerText.includes("RESULT-RETRY-UID")`,
    "successful approved-player data to render inside the still-open Result Entry panel",
  );
  assert(
    await evaluate(`Boolean(document.querySelector(${JSON.stringify(panelSelector)}))`),
    "Result Entry should stay open after its retry succeeds.",
  );

  await clickSelector(openSelector, "closing the recovered Result Entry panel");
  await waitForCondition(
    `!document.querySelector('${panelSelector}')`,
    "the recovered Result Entry panel to close",
  );
  await clickSelector(openSelector, "reopening Result Entry for the same tournament");
  await waitForCondition(
    `window.__daily007TournamentResume.getApprovedRegistrationRequests().length === 3 &&
      document.body.innerText.includes("Reopened Result Entry request failed.")`,
    "a later approved-registration request to fail without closing Result Entry",
  );
  assert(
    await evaluate(`Boolean(document.querySelector(${JSON.stringify(panelSelector)}))`),
    "Result Entry should stay open after the reopened request fails.",
  );
  await clickSelector(retrySelector, "retrying the reopened Result Entry panel");
  await waitForCondition(
    `window.__daily007TournamentResume.getApprovedRegistrationRequests().length === 4 &&
      document.body.innerText.includes("Second retry request failed.")`,
    "the later retry to fail while keeping Result Entry available",
  );
  const requests = await evaluate("window.__daily007TournamentResume.getApprovedRegistrationRequests()");
  assert(
    JSON.stringify(requests) === JSON.stringify(Array(4).fill(tournamentId)),
    `Approved-registration requests must target only the active tournament: ${JSON.stringify(requests)}.`,
  );
  assert(
    await evaluate(`Boolean(document.querySelector(${JSON.stringify(panelSelector)})) && document.querySelector(${JSON.stringify(retrySelector)})?.disabled === false`),
    "The retry control should become available again after the later failure.",
  );
}

async function triggerPlayerManualRefresh() {
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await tapSelector(
    '[data-testid="player-refresh-control-test-action"]',
    "Player pull-to-refresh control",
  );
}

async function assertPlayerRefreshTextReadable({ width, fontScale, cardName, errorExpected }) {
  const state = await evaluate(`(() => {
    const findText = (text) => [...document.querySelectorAll("*")].find((element) =>
      element.children.length === 0 && element.textContent?.trim() === text
    );
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    return {
      fontScale: window.__daily007LargeTextScale ?? 1,
      card: box(findText(${JSON.stringify(cardName)})),
      errorNode: box(document.querySelector('[data-testid="player-tournament-refresh-error"]')),
      errorText: document.querySelector('[data-testid="player-tournament-refresh-error"]')?.textContent?.trim() ?? null,
    };
  })()`);
  assert(state?.fontScale === fontScale, `The Player preview did not apply ${fontScale}× Android text scale.`);
  assert(state?.card, `The retained Player card title "${cardName}" is missing at ${fontScale}× text.`);
  for (const [label, box] of [["card", state.card], ["refresh error", state.errorNode]].filter(([, box]) => box)) {
    assert(
      box.left >= -1 && box.right <= width + 1 &&
        box.scrollWidth <= box.clientWidth + 2 &&
        box.scrollHeight <= box.clientHeight + 2,
      `The ${label} text is clipped at ${width}px and ${fontScale}× text: ${JSON.stringify(box)}.`,
    );
  }
  if (errorExpected) {
    assert(
      state.errorNode && state.errorText?.includes("Could not refresh tournaments: Held Player refresh failed"),
      `The refresh error is missing at ${fontScale}× text: ${JSON.stringify(state)}.`,
    );
    assert(
      state.errorNode.bottom <= state.card.top + 2,
      `The refresh error overlaps the retained card at ${fontScale}× text: ${JSON.stringify(state)}.`,
    );
  } else {
    assert(!state.errorNode, `The refresh error should clear after recovery at ${fontScale}× text.`);
  }
  await assertPageHasNoHorizontalOverflow(width, `Player refresh at ${fontScale}× Android text`);
}

async function checkTournamentManualRefresh({
  width = 390,
  fontScale = 1,
  initialName = "IST Start Boundary",
  refreshedName = "Player Manually Refreshed IST Start Boundary",
  includeSelectedTabRefreshChecks = true,
} = {}) {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Player pull-to-refresh preview to initialize",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes(${JSON.stringify(initialName)})`,
    "the Player list to load its tournament before manual refresh",
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getLoadAnnouncementEvents()
      .filter((event) => event.testID === 'player-tournament-refresh-announcement').length`) === 0,
    "An ordinary successful Player list load must not announce refresh recovery.",
  );

  const visibilityChangesBeforeRefresh = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  let readsBeforeRefresh = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.deferNextTournamentRead()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Refreshing'`,
    "the Player pull-to-refresh request to remain pending",
  );
  await triggerPlayerManualRefresh();
  await triggerPlayerManualRefresh();
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBeforeRefresh + 1,
    "Repeated Player pulls while refreshing must not send duplicate tournament requests.",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"player-refresh-control-pending\"]')?.textContent === 'Refreshing'"),
    "The Player refresh indicator must remain active while the held request is pending.",
  );

  const heldReadFailed = await evaluate(
    "window.__daily007TournamentResume.failDeferredTournamentRead('Held Player refresh failed')",
  );
  assert(heldReadFailed, "The test must release the held Player request with a failure.");
  await waitForCondition(
    `document.body.innerText.includes('Could not refresh tournaments: Held Player refresh failed') && document.body.innerText.includes(${JSON.stringify(initialName)}) && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Ready'`,
    "the failed Player refresh to show one error, preserve the loaded card, and stop refreshing",
  );
  await assertPlayerRefreshTextReadable({
    width,
    fontScale,
    cardName: initialName,
    errorExpected: true,
  });
  await assertText(initialName, "the Player tournament after a failed manual refresh");
  const refreshErrorAccessibility = await evaluate(`(() => {
    const container = document.querySelector('[data-testid="player-tournament-refresh-error"]');
    const liveRegion = container?.querySelector('[aria-live]');
    return {
      liveRegion: liveRegion?.getAttribute('aria-live') ?? null,
      label: liveRegion?.getAttribute('aria-label') ?? null,
      cardVisible: document.body.innerText.includes(${JSON.stringify(initialName)}),
      announcements: window.__daily007TournamentResume.getLoadAnnouncementEvents()
        .filter((event) => event.testID === 'player-tournament-refresh-error'),
    };
  })()`);
  assert(
    refreshErrorAccessibility.liveRegion === 'polite',
    `A failed refresh must expose its error as a polite TalkBack live region: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    refreshErrorAccessibility.label === 'Could not refresh tournaments: Held Player refresh failed',
    `A failed refresh must have a clear accessible label: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    refreshErrorAccessibility.cardVisible,
    `The existing tournament must remain visible with the refresh announcement: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    JSON.stringify(refreshErrorAccessibility.announcements) === JSON.stringify([{
      testID: 'player-tournament-refresh-error',
      text: 'Could not refresh tournaments: Held Player refresh failed',
    }]),
    `A single failed refresh should produce one clear announcement: ${JSON.stringify(refreshErrorAccessibility.announcements)}.`,
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getLoadAnnouncementEvents()
      .filter((event) => event.testID === 'player-tournament-refresh-announcement').length`) === 0,
    "A failed refresh must wait for recovery before announcing that tournaments updated.",
  );
  assert(
    await evaluate("document.body.innerText.split('Could not refresh tournaments: Held Player refresh failed').length - 1") === 1,
    "A failed Player refresh must leave exactly one clear error visible.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeRefresh,
    "A manual pull-to-refresh must not depend on an AppState resume event.",
  );

  await evaluate(
    `window.__daily007TournamentResume.updateTournament({ name: ${JSON.stringify(refreshedName)} })`,
  );
  readsBeforeRefresh = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.body.innerText.includes(${JSON.stringify(refreshedName)}) && !document.body.innerText.includes('Could not refresh tournaments: Held Player refresh failed')`,
    "a later successful manual refresh to update the Player card and clear its error",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getLoadAnnouncementEvents()
      .filter((event) => event.testID === 'player-tournament-refresh-announcement')
      .some((event) => event.text === 'Tournaments updated.')`,
    "the one-time announcement confirming the failed Player refresh recovered",
  );
  assert(
    JSON.stringify(await evaluate(`window.__daily007TournamentResume.getLoadAnnouncementEvents()
      .filter((event) => event.testID === 'player-tournament-refresh-announcement')`)) === JSON.stringify([{
      testID: 'player-tournament-refresh-announcement',
      text: 'Tournaments updated.',
    }]),
    "A recovered Player refresh must produce exactly one concise announcement.",
  );
  await assertPlayerRefreshTextReadable({
    width,
    fontScale,
    cardName: refreshedName,
    errorExpected: false,
  });
  await assertText(
    refreshedName,
    "the updated Player tournament after manual refresh",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeRefresh,
    "The successful manual refresh must not depend on an AppState resume event.",
  );
  if (!includeSelectedTabRefreshChecks) return;

  const assertSelectedPlayerTabRefresh = async (status, expectedCount, names) => {
    const state = await evaluate(`(() => {
      const tab = document.querySelector('[data-testid="tournament-tab-${status}"]');
      const otherTabs = ["upcoming", "ongoing", "completed"]
        .filter((value) => value !== "${status}")
        .map((value) => document.querySelector('[data-testid="tournament-tab-' + value + '"]'));
      const tabBorder = tab ? getComputedStyle(tab).borderColor : null;
      return {
        label: tab?.getAttribute("aria-label") ?? null,
        selected: tab?.getAttribute("aria-pressed") === "true" ||
          tab?.getAttribute("aria-selected") === "true" ||
          Boolean(tab && otherTabs.every((other) =>
            other && getComputedStyle(other).borderColor !== tabBorder
          )),
        body: document.body.innerText,
      };
    })()`);
    assert(
      state?.selected,
      `Refreshing from ${status} must keep that Player tab selected.`,
    );
    assert(
      state?.label?.startsWith(`${status[0].toUpperCase()}${status.slice(1)} tournaments, `) &&
        state.label.endsWith(`, ${expectedCount}`),
      `${status} tab count should reflect ${expectedCount} refreshed cards: ${JSON.stringify(state?.label)}.`,
    );
    for (const name of names) {
      assert(
        state.body.includes(name),
        `${status} should show refreshed card "${name}".`,
      );
    }
  };

  await clickSelector('[data-testid="tournament-tab-ongoing"]', "Player Ongoing filter before refresh");
  await waitForCondition(
    `document.body.innerText.includes('No ongoing tournaments are available right now.')`,
    "the empty Ongoing list before its response changes",
  );
  const ongoingNames = ["Ongoing Refresh One", "Ongoing Refresh Two"];
  assert(
    await evaluate(`window.__daily007TournamentResume.setTournamentResponseFixtures([
      { id: 'ongoing-refresh-one', name: '${ongoingNames[0]}', status: 'ongoing' },
      { id: 'ongoing-refresh-two', name: '${ongoingNames[1]}', status: 'ongoing' },
    ])`),
    "Could not configure the refreshed Ongoing tournament response.",
  );
  readsBeforeRefresh = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.body.innerText.includes('${ongoingNames[0]}') && document.body.innerText.includes('${ongoingNames[1]}')`,
    "the refreshed Ongoing cards to appear",
  );
  await assertSelectedPlayerTabRefresh("ongoing", 2, ongoingNames);

  await clickSelector('[data-testid="tournament-tab-completed"]', "Player Completed filter before refresh");
  await waitForCondition(
    `document.body.innerText.includes('No completed tournaments are available right now.')`,
    "the empty Completed list before its response changes",
  );
  const completedNames = ["Completed Refresh One", "Completed Refresh Two"];
  assert(
    await evaluate(`window.__daily007TournamentResume.setTournamentResponseFixtures([
      { id: 'completed-refresh-one', name: '${completedNames[0]}', status: 'completed' },
      { id: 'completed-refresh-two', name: '${completedNames[1]}', status: 'completed' },
    ])`),
    "Could not configure the refreshed Completed tournament response.",
  );
  readsBeforeRefresh = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.body.innerText.includes('${completedNames[0]}') && document.body.innerText.includes('${completedNames[1]}')`,
    "the refreshed Completed cards to appear",
  );
  await assertSelectedPlayerTabRefresh("completed", 2, completedNames);
  assert(
    JSON.stringify(await evaluate(`window.__daily007TournamentResume.getLoadAnnouncementEvents()
      .filter((event) => event.testID === 'player-tournament-refresh-announcement')`)) === JSON.stringify([{
      testID: 'player-tournament-refresh-announcement',
      text: 'Tournaments updated.',
    }]),
    "Routine successful Player refreshes must not repeat the recovery announcement.",
  );
}

async function checkTournamentRefreshAfterReturning() {
  const initialName = "IST Start Boundary";
  const currentName = "Current Tournament After Returning";
  const staleName = "Stale Pending Tournament Response";
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true && document.body.innerText.includes('IST Start Boundary')",
    "the Player tournament list to load before leaving",
  );

  const readsBeforeRefresh = await evaluate(
    "window.__daily007TournamentResume.getTournamentReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.deferNextTournamentRead()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Refreshing'`,
    "the old Player pull to remain pending",
  );

  await evaluate("window.__daily007TournamentResume.setScreenFocused(false)");
  await evaluate(
    `window.__daily007TournamentResume.updateTournament({ name: ${JSON.stringify(currentName)} })`,
  );
  await evaluate("window.__daily007TournamentResume.setScreenFocused(true)");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 2} && document.body.innerText.includes(${JSON.stringify(currentName)})`,
    "the Player screen to load current data when returning",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"player-refresh-control-pending\"]')?.textContent === 'Refreshing'"),
    "The older pull should still own its active indicator while its request is pending.",
  );
  assert(
    await evaluate(`document.body.innerText.includes(${JSON.stringify(currentName)}) && !document.body.innerText.includes('Could not refresh tournaments')`),
    "Returning should show current tournament data without showing a stale error.",
  );

  const released = await evaluate(`window.__daily007TournamentResume.resolveDeferredTournamentRead([{
    id: 'resume-boundary',
    name: ${JSON.stringify(staleName)},
    status: 'upcoming',
  }])`);
  assert(released, "The old pending pull must be resolved after the returning screen loads.");
  await waitForCondition(
    `document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Ready' && document.body.innerText.includes(${JSON.stringify(currentName)})`,
    "the old request to settle without leaving refresh active or replacing the current card",
  );
  assert(
    !await evaluate(`document.body.innerText.includes(${JSON.stringify(staleName)}) || document.body.innerText.includes('Could not refresh tournaments')`),
    "The stale request must neither replace current data nor show a stale error.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBeforeRefresh + 2,
    "Resolving the held request must not trigger another tournament read.",
  );
}

async function checkTournamentRefreshCoalescing() {
  const initialName = "IST Start Boundary";
  const refreshedName = "App Resume Refresh With Manual Pull";
  await waitForCondition(
    `window.__daily007TournamentResume?.ready === true && document.body.innerText.includes(${JSON.stringify(initialName)})`,
    "the Player list to load before refresh-coalescing checks",
  );

  let readsBefore = await evaluate(
    "window.__daily007TournamentResume.getTournamentReadCount()",
  );
  let registrationReadsBefore = await evaluate(
    "window.__daily007TournamentResume.getMyRegistrationReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.deferNextTournamentRead()");
  await evaluate("window.__daily007TournamentResume.resumeCurrentList()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBefore + 1} && window.__daily007TournamentResume.getMyRegistrationReadCount() === ${registrationReadsBefore + 1}`,
    "the app-resume tournament request to start",
  );
  await triggerPlayerManualRefresh();
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBefore + 1,
    "A manual pull during an app-resume request should share that request instead of duplicating it.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getMyRegistrationReadCount()") === registrationReadsBefore + 1,
    "A manual pull during an app-resume request should not duplicate the registration lookup either.",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"player-refresh-control-pending\"]')?.textContent === 'Refreshing'"),
    "The pull indicator should remain active while the shared request is pending.",
  );

  await evaluate(
    `window.__daily007TournamentResume.updateTournament({ name: ${JSON.stringify(refreshedName)} })`,
  );
  const successfulRelease = await evaluate(`window.__daily007TournamentResume.resolveDeferredTournamentRead([{
    id: 'resume-boundary',
    name: ${JSON.stringify(refreshedName)},
    status: 'upcoming',
  }])`);
  assert(successfulRelease, "The shared app-resume request should be resolvable for the success case.");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(refreshedName)}) && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Ready'`,
    "the successful shared request to update the card and stop refreshing",
  );
  assert(
    !await evaluate("document.body.innerText.includes('Could not refresh tournaments')"),
    "A successful shared request must not leave a refresh error visible.",
  );

  readsBefore = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  registrationReadsBefore = await evaluate(
    "window.__daily007TournamentResume.getMyRegistrationReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.deferNextTournamentRead()");
  await evaluate("window.__daily007TournamentResume.resumeCurrentList()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBefore + 1} && window.__daily007TournamentResume.getMyRegistrationReadCount() === ${registrationReadsBefore + 1}`,
    "a second app-resume tournament request to start",
  );
  await triggerPlayerManualRefresh();
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBefore + 1,
    "A manual pull during the second app-resume request must not issue a duplicate read.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getMyRegistrationReadCount()") === registrationReadsBefore + 1,
    "The failed coalesced refresh must not issue a duplicate registration lookup.",
  );

  const failedRelease = await evaluate(
    `window.__daily007TournamentResume.failDeferredTournamentRead("App-resume refresh failed")`,
  );
  assert(failedRelease, "The shared app-resume request should be rejectable for the failure case.");
  await waitForCondition(
    `document.body.innerText.includes('Could not refresh tournaments: App-resume refresh failed') && document.body.innerText.includes(${JSON.stringify(refreshedName)}) && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Ready'`,
    "the failed shared request to preserve the card, show one error, and stop refreshing",
  );
  assert(
    await evaluate("document.body.innerText.split('Could not refresh tournaments: App-resume refresh failed').length - 1") === 1,
    "A failed shared request should show one clear error.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getTournamentReadCount()") === readsBefore + 1,
    "The failed shared request should not create another tournament read.",
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

const istRolloverExpectations = [
  {
    name: "IST Month-End Boundary",
    laterName: "Later Month-End Start",
    date: "2026-05-01",
    dateLabel: "01 MAY",
    previousDate: "2026-04-30",
    utcDate: "2026-04-30",
  },
  {
    name: "IST New Year Boundary",
    laterName: "Later New Year Start",
    date: "2027-01-01",
    dateLabel: "01 JAN",
    previousDate: "2026-12-31",
    utcDate: "2026-12-31",
  },
  {
    name: "IST Leap-Day Boundary",
    laterName: "Later Leap-Day Start",
    date: "2028-02-29",
    dateLabel: "29 FEB",
    previousDate: "2028-02-28",
    utcDate: "2028-02-28",
  },
];

async function assertIstRolloverSchedules(screenName, expected) {
  const scheduleInfo = await evaluate("window.__daily007TournamentResume.getScheduledStartInfo()");
  assert(
    scheduleInfo.browserTimeZone === "America/Los_Angeles",
    `${screenName} scheduled-start test must run with a non-IST browser timezone.`,
  );
  assert(
    scheduleInfo.schedules.length === 2,
    `${screenName} must load both schedules for the fixed IST calendar boundary.`,
  );
  for (const [index, name] of [expected.name, expected.laterName].entries()) {
    const schedule = scheduleInfo.schedules[index];
    assert(schedule.name === name, `${screenName} schedule ${index + 1} must be ${name}.`);
    assert(
      schedule.istDate === expected.date &&
        schedule.date === expected.date &&
        schedule.istDateLabel === expected.dateLabel,
      `${screenName} ${expected.name} must retain IST date ${expected.date} (${expected.dateLabel}), got ${schedule.date} / ${schedule.istDateLabel}.`,
    );
    assert(
      schedule.istTime === (index === 0 ? "00:00:01" : "00:00:04"),
      `${screenName} ${name} must keep its exact IST start time, got ${schedule.istTime}.`,
    );
    assert(
      schedule.utcDate === expected.utcDate,
      `${screenName} ${expected.name} must cross the UTC date boundary too.`,
    );
    assert(
      schedule.startsAt.endsWith("+05:30") &&
        Date.parse(schedule.startsAt) === schedule.startMs,
      `${screenName} ${expected.name} must preserve the IST offset and compare against its exact real start instant.`,
    );
  }
  return scheduleInfo;
}

async function assertClockImmediatelyBeforeIstBoundary(screenName, scheduleInfo, expected, index) {
  const schedule = scheduleInfo.schedules[index];
  const expectedDate = index === 0 ? expected.previousDate : expected.date;
  const expectedTime = index === 0 ? "23:59:59" : "00:00:02";
  assert(
    scheduleInfo.beforeIstTime === expectedTime &&
      scheduleInfo.beforeIstDate === expectedDate &&
      schedule.startMs - scheduleInfo.nowMs === 2_000,
    `${screenName} clock must be two seconds before ${schedule.name} on ${expectedDate}, got ${scheduleInfo.beforeIstDate} ${scheduleInfo.beforeIstTime}.`,
  );
}

async function assertAdminScheduledStartState({
  selectedTab,
  counts,
  tournamentNames,
  actions,
  nameCandidates,
}, description) {
  const state = await evaluate(`(() => {
    const statuses = ["upcoming", "ongoing", "completed"];
    const tabs = Object.fromEntries(
      statuses.map((status) => [
        status,
        document.querySelector('[data-testid="admin-tournament-tab-' + status + '"]'),
      ])
    );
    const actionIds = [
      "edit-tournament-resume-boundary",
      "delete-tournament-resume-boundary",
      "manage-room-resume-boundary",
      "cancel-tournament-resume-boundary",
      "finish-tournament-resume-boundary",
      "edit-tournament-resume-boundary-later",
      "delete-tournament-resume-boundary-later",
      "manage-room-resume-boundary-later",
      "cancel-tournament-resume-boundary-later",
      "finish-tournament-resume-boundary-later",
    ];
    const pageText = window.__daily007TournamentResume.getVisibleText();
    return {
      adminScreenVisible: Boolean(document.querySelector('[data-testid="admin-tournament-status-tabs"]')),
      selectedTab: statuses.find((status) =>
        tabs[status] && getComputedStyle(tabs[status]).borderColor === "rgb(255, 61, 61)"
      ) ?? null,
      counts: Object.fromEntries(
        statuses.map((status) => [status, tabs[status]?.getAttribute("aria-label") ?? null])
      ),
      tournamentNames: ${JSON.stringify(nameCandidates)}
        .filter((name) => pageText.includes(name))
        .sort(),
      actions: actionIds.filter((id) =>
        Boolean(document.querySelector('[data-testid="' + id + '"]'))
      ).sort(),
    };
  })()`);
  assert(state.adminScreenVisible, `${description}: AdminTournaments is no longer visible.`);
  assert(
    state.selectedTab === selectedTab,
    `${description}: expected ${selectedTab} to remain selected, got ${state.selectedTab}.`,
  );
  assert(
    JSON.stringify(state.counts) === JSON.stringify(counts),
    `${description}: wrong lifecycle tab counts: ${JSON.stringify(state.counts)}.`,
  );
  assert(
    JSON.stringify(state.tournamentNames) === JSON.stringify([...tournamentNames].sort()),
    `${description}: wrong visible tournament rows: ${JSON.stringify(state.tournamentNames)}.`,
  );
  assert(
    JSON.stringify(state.actions) === JSON.stringify([...actions].sort()),
    `${description}: wrong available management actions: ${JSON.stringify(state.actions)}.`,
  );
}

async function checkTournamentScheduledStart(boundaryIndex) {
  const expected = istRolloverExpectations[boundaryIndex];
  const firstName = expected.name;
  const laterName = expected.laterName;
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the timed-start preview to initialize",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes(${JSON.stringify(firstName)}) && document.body.innerText.includes(${JSON.stringify(laterName)})`,
    `the player list to load both ${expected.name} test tournaments`,
  );
  const playerScheduleInfo = await assertIstRolloverSchedules("Player", expected);
  const currentIstYear = await evaluate(
    "Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date()))",
  );
  await assertClockImmediatelyBeforeIstBoundary("Player", playerScheduleInfo, expected, 0);
  for (const schedule of playerScheduleInfo.schedules) {
    const year = schedule.istDate.slice(0, 4);
    const expectedDateLabel = Number(year) === currentIstYear
      ? schedule.istDateLabel
      : `${schedule.istDateLabel} ${year}`;
    const playerDateTime = `${expectedDateLabel} • ${schedule.time} IST`;
    assert(
      await evaluate(`document.body.innerText.includes(${JSON.stringify(playerDateTime)})`),
      `Player card for ${schedule.name} must display its IST date, include the year only when it differs from the current IST year, and retain its time (${playerDateTime}) in a non-IST browser timezone.`,
    );
  }

  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments are available right now.')",
    "the player Ongoing list to be empty before its scheduled start",
  );
  const visibilityChangesBeforePlayerStarts = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityState() === 'visible'"),
    "The player list must stay visible while its scheduled starts pass.",
  );
  let tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`,
    "the player list timer to move only the first tournament into Ongoing",
  );
  const playerFirstAnnouncement = `Tournament ${firstName} is now ongoing.`;
  await waitForCondition(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(playerFirstAnnouncement)}`,
    "the Player screen reader announcement for the first scheduled start",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"tournament-start-announcement\"]')?.getAttribute('aria-live') === 'polite'"),
    "The Player announcement must use a polite live region.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The first Player start announcement must not move accessibility focus.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforePlayerStarts,
    "The first player start-time transition must not depend on an AppState visibility/resume event.",
  );
  await assertText(firstName, `${expected.name} after its scheduled start`);
  const playerReadsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.resumeCurrentList()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${playerReadsBeforeResume}`,
    "the Player list to refresh after the simulated app resume",
  );
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(playerFirstAnnouncement)}`),
    "Refreshing the Player list after resume must not repeat the first start announcement.",
  );
  const visibilityChangesBeforeSecondPlayerStarts = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  await clickSelector('[data-testid="tournament-tab-upcoming"]', "player Upcoming filter");
  await waitForCondition(
    `window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)})`,
    "the later player tournament to remain Upcoming after the first start",
  );
  await evaluate("window.__daily007TournamentResume.setClockBeforeSecondStart()");
  const playerBeforeNewYear = await evaluate("window.__daily007TournamentResume.getScheduledStartInfo()");
  await assertClockImmediatelyBeforeIstBoundary("Player", playerBeforeNewYear, expected, 1);
  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  await waitForCondition(
    `window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`,
    `the later ${expected.name} tournament to remain Upcoming immediately before its exact start`,
  );
  await clickSelector('[data-testid="tournament-tab-upcoming"]', "player Upcoming filter before New Year start");
  await assertText(laterName, `the later ${expected.name} tournament just before its scheduled start`);
  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter before New Year start");
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastSecondStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`,
    "the player list timer to move the later tournament into Ongoing at its own start",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeSecondPlayerStarts,
    "The second player start-time transition must not depend on an AppState visibility/resume event.",
  );
  const playerLaterAnnouncement = `Tournament ${laterName} is now ongoing.`;
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(playerLaterAnnouncement)}`),
    "The Player screen reader announcement must identify the later staggered start.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The second Player start announcement must not move accessibility focus.",
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)})`),
    `${expected.name} must remain visible in the Player Ongoing list after both starts.`,
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`),
    `The later ${expected.name} tournament must appear in the Player Ongoing list after its start.`,
  );

  await evaluate("window.__daily007TournamentResume.prepareAdminForScheduledStart()");
  await evaluate("window.__daily007TournamentResume.showAdmin()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes(${JSON.stringify(firstName)}) && document.body.innerText.includes(${JSON.stringify(laterName)})`,
    `the Admin list to load both ${expected.name} test tournaments`,
  );
  const adminScheduleInfo = await assertIstRolloverSchedules("Admin", expected);
  await assertClockImmediatelyBeforeIstBoundary("Admin", adminScheduleInfo, expected, 0);
  for (const schedule of adminScheduleInfo.schedules) {
    const adminDateTime = `${schedule.date} • ${schedule.time} IST`;
    assert(
      await evaluate(`document.body.innerText.includes(${JSON.stringify(adminDateTime)})`),
      `Admin card for ${schedule.name} must display its IST date and time (${adminDateTime}) in a non-IST browser timezone.`,
    );
  }
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments.')",
    "the Admin Ongoing list to be empty before its scheduled start",
  );
  await assertAdminScheduledStartState({
    selectedTab: "ongoing",
    counts: {
      upcoming: "Upcoming tournaments, 2",
      ongoing: "Ongoing tournaments, 0",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [],
    actions: [],
    nameCandidates: [firstName, laterName],
  }, "before the first Admin scheduled start");
  const visibilityChangesBeforeAdminStarts = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityState() === 'visible'"),
    "The Admin list must stay visible while its scheduled starts pass.",
  );
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.failNextTournamentRead()");
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)}) && window.__daily007TournamentResume.getVisibleText().includes('Could not refresh tournaments: Temporary network error')`,
    "the Admin clock to move only the first tournament into Ongoing even when its scheduled refresh fails",
  );
  await assertAdminScheduledStartState({
    selectedTab: "ongoing",
    counts: {
      upcoming: "Upcoming tournaments, 1",
      ongoing: "Ongoing tournaments, 1",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [firstName],
    actions: [
      "cancel-tournament-resume-boundary",
      "manage-room-resume-boundary",
      "finish-tournament-resume-boundary",
    ],
    nameCandidates: [firstName, laterName],
  }, "after the first Admin scheduled start without leaving the screen");
  const adminFirstAnnouncement = `Tournament ${firstName} is now ongoing.`;
  await waitForCondition(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(adminFirstAnnouncement)}`,
    "the Admin screen reader announcement for the first scheduled start",
  );
  assert(
    await evaluate("document.querySelector('[data-testid=\"tournament-start-announcement\"]')?.getAttribute('aria-live') === 'polite'"),
    "The Admin announcement must use a polite live region.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The first Admin start announcement must not move accessibility focus.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeAdminStarts,
    "The first Admin start-time transition must not depend on an app background/resume event.",
  );
  await assertText(firstName, `${expected.name} after its scheduled start`);
  const adminReadsBeforeResume = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.resumeCurrentList()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${adminReadsBeforeResume}`,
    "the Admin list to refresh after the simulated app resume",
  );
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(adminFirstAnnouncement)}`),
    "Refreshing the Admin list after resume must not repeat the first start announcement.",
  );
  const visibilityChangesBeforeSecondAdminStarts = await evaluate(
    "window.__daily007TournamentResume.getVisibilityChangeCount()",
  );
  await clickSelector('[data-testid="admin-tournament-tab-upcoming"]', "Admin Upcoming filter");
  await waitForCondition(
    `window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)})`,
    "the later Admin tournament to remain Upcoming after the first start",
  );
  await assertAdminScheduledStartState({
    selectedTab: "upcoming",
    counts: {
      upcoming: "Upcoming tournaments, 1",
      ongoing: "Ongoing tournaments, 1",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [laterName],
    actions: [
      "edit-tournament-resume-boundary-later",
      "delete-tournament-resume-boundary-later",
      "manage-room-resume-boundary-later",
    ],
    nameCandidates: [firstName, laterName],
  }, "after the first-started tournament leaves Upcoming");
  await evaluate("window.__daily007TournamentResume.setClockBeforeSecondStart()");
  const adminBeforeNewYear = await evaluate("window.__daily007TournamentResume.getScheduledStartInfo()");
  await assertClockImmediatelyBeforeIstBoundary("Admin", adminBeforeNewYear, expected, 1);
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  await waitForCondition(
    `window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && !window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`,
    `the later ${expected.name} tournament to remain Upcoming immediately before its exact start`,
  );
  await clickSelector('[data-testid="admin-tournament-tab-upcoming"]', "Admin Upcoming filter before New Year start");
  await assertText(laterName, `the later ${expected.name} tournament just before its scheduled start`);
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter before New Year start");
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastSecondStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) && window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)}) && !window.__daily007TournamentResume.getVisibleText().includes('Could not refresh tournaments: Temporary network error')`,
    "the Admin list timer to move the later tournament into Ongoing at its own start",
  );
  await assertAdminScheduledStartState({
    selectedTab: "ongoing",
    counts: {
      upcoming: "Upcoming tournaments, 0",
      ongoing: "Ongoing tournaments, 2",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [firstName, laterName],
    actions: [
      "cancel-tournament-resume-boundary",
      "manage-room-resume-boundary",
      "finish-tournament-resume-boundary",
      "cancel-tournament-resume-boundary-later",
      "manage-room-resume-boundary-later",
      "finish-tournament-resume-boundary-later",
    ],
    nameCandidates: [firstName, laterName],
  }, "after both Admin scheduled starts");
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeSecondAdminStarts,
    "The second Admin start-time transition must not depend on an app background/resume event.",
  );
  const adminLaterAnnouncement = `Tournament ${laterName} is now ongoing.`;
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(adminLaterAnnouncement)}`),
    "The Admin screen reader announcement must identify the later staggered start.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The second Admin start announcement must not move accessibility focus.",
  );
  assert(
    !await evaluate("document.body.innerText.includes('Could not refresh tournaments: Temporary network error')"),
    "A successful scheduled Admin refresh should clear the earlier request error.",
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)})`),
    `${expected.name} must remain visible in the Admin Ongoing list after both starts.`,
  );
  assert(
    await evaluate(`window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(laterName)})`),
    `The later ${expected.name} tournament must appear in the Admin Ongoing list after its start.`,
  );
}

async function checkSimultaneousTournamentStarts() {
  const firstName = "IST Month-End Boundary";
  const secondName = "Later Month-End Start";
  const expectedAnnouncement =
    `Tournament ${firstName} is now ongoing. Tournament ${secondName} is now ongoing.`;

  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the simultaneous-start preview to initialize",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > 0 &&
      document.body.innerText.includes(${JSON.stringify(firstName)}) &&
      document.body.innerText.includes(${JSON.stringify(secondName)})`,
    "the Player list to load both simultaneous-start tournaments",
  );
  const playerSchedules = await evaluate(
    "window.__daily007TournamentResume.getScheduledStartInfo().schedules",
  );
  assert(
    playerSchedules.length === 2 && playerSchedules[0].startMs === playerSchedules[1].startMs,
    `Player tournaments must share an exact start instant: ${JSON.stringify(playerSchedules)}.`,
  );

  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments are available right now.')",
    "the Player Ongoing list to be empty before the shared start",
  );
  let tournamentReads = await evaluate(
    "window.__daily007TournamentResume.getTournamentReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} &&
      window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) &&
      window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(secondName)})`,
    "both Player tournaments to become ongoing at their shared start",
  );
  await waitForCondition(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(expectedAnnouncement)}`,
    "one Player announcement to include both simultaneous starts",
  );
  let announcement = await evaluate(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim()`,
  );
  assert(
    (announcement.match(new RegExp(firstName, "g")) ?? []).length === 1 &&
      (announcement.match(new RegExp(secondName, "g")) ?? []).length === 1,
    `Each Player tournament must be named exactly once: ${JSON.stringify(announcement)}.`,
  );
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.getAttribute('aria-live') === 'polite'`),
    "The Player simultaneous-start message must remain a polite live-region update.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The Player simultaneous-start announcement must not move focus.",
  );

  await evaluate("window.__daily007TournamentResume.prepareAdminForScheduledStart()");
  await evaluate("window.__daily007TournamentResume.showAdmin()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > 0 &&
      document.body.innerText.includes(${JSON.stringify(firstName)}) &&
      document.body.innerText.includes(${JSON.stringify(secondName)})`,
    "the Admin list to load both simultaneous-start tournaments",
  );
  const adminSchedules = await evaluate(
    "window.__daily007TournamentResume.getScheduledStartInfo().schedules",
  );
  assert(
    adminSchedules.length === 2 && adminSchedules[0].startMs === adminSchedules[1].startMs,
    `Admin tournaments must share an exact start instant: ${JSON.stringify(adminSchedules)}.`,
  );
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  await waitForCondition(
    "document.body.innerText.includes('No ongoing tournaments.')",
    "the Admin Ongoing list to be empty before the shared start",
  );
  await assertAdminScheduledStartState({
    selectedTab: "ongoing",
    counts: {
      upcoming: "Upcoming tournaments, 2",
      ongoing: "Ongoing tournaments, 0",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [],
    actions: [],
    nameCandidates: [firstName, secondName],
  }, "before the shared Admin scheduled start");
  tournamentReads = await evaluate(
    "window.__daily007TournamentResume.getTournamentReadCount()",
  );
  await evaluate("window.__daily007TournamentResume.rememberFocus()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} &&
      window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(firstName)}) &&
      window.__daily007TournamentResume.getVisibleText().includes(${JSON.stringify(secondName)})`,
    "both Admin tournaments to become ongoing at their shared start",
  );
  await assertAdminScheduledStartState({
    selectedTab: "ongoing",
    counts: {
      upcoming: "Upcoming tournaments, 0",
      ongoing: "Ongoing tournaments, 2",
      completed: "Completed tournaments, 0",
    },
    tournamentNames: [firstName, secondName],
    actions: [
      "cancel-tournament-resume-boundary",
      "manage-room-resume-boundary",
      "finish-tournament-resume-boundary",
      "cancel-tournament-resume-boundary-later",
      "manage-room-resume-boundary-later",
      "finish-tournament-resume-boundary-later",
    ],
    nameCandidates: [firstName, secondName],
  }, "after both simultaneous Admin starts");
  await waitForCondition(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim() === ${JSON.stringify(expectedAnnouncement)}`,
    "one Admin announcement to include both simultaneous starts",
  );
  announcement = await evaluate(
    `document.querySelector('[data-testid="tournament-start-announcement"]')?.textContent?.trim()`,
  );
  assert(
    (announcement.match(new RegExp(firstName, "g")) ?? []).length === 1 &&
      (announcement.match(new RegExp(secondName, "g")) ?? []).length === 1,
    `Each Admin tournament must be named exactly once: ${JSON.stringify(announcement)}.`,
  );
  assert(
    await evaluate(`document.querySelector('[data-testid="tournament-start-announcement"]')?.getAttribute('aria-live') === 'polite'`),
    "The Admin simultaneous-start message must remain a polite live-region update.",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.focusUnchanged()"),
    "The Admin simultaneous-start announcement must not move focus.",
  );
}

async function readHomeCarouselState() {
  return evaluate(`(() => {
    const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
    const indicatorContainer = document.querySelector('[data-testid="home-upcoming-page-indicators"]');
    if (!carousel) return null;
    const viewport = carousel.getBoundingClientRect();
    const dots = indicatorContainer
      ? [...indicatorContainer.querySelectorAll('[data-testid^="home-upcoming-page-dot-"]')]
      : [];
    return {
      viewport: { left: viewport.left, right: viewport.right, width: carousel.clientWidth },
      scrollLeft: carousel.scrollLeft,
      cards: [...carousel.querySelectorAll('[data-testid^="home-upcoming-card-"]')].map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          id: card.getAttribute('data-testid')?.replace('home-upcoming-card-', ''),
          label: card.getAttribute('aria-label'),
          role: card.getAttribute('role'),
          ariaPressed: card.getAttribute('aria-pressed'),
          ariaSelected: card.getAttribute('aria-selected'),
          ariaCurrent: card.getAttribute('aria-current'),
          selected:
            card.getAttribute('aria-pressed') === 'true' ||
            card.getAttribute('aria-selected') === 'true' ||
            card.getAttribute('aria-current') === 'true',
          focusStops:
            Number(card.matches('button, [role="button"], [tabindex="0"]')) +
            card.querySelectorAll('button, [role="button"], [tabindex="0"]').length,
          left: rect.left,
          right: rect.right,
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
        };
      }),
      indicatorPresent: Boolean(indicatorContainer),
      indicatorCount: dots.length,
      activePage: indicatorContainer
        ? dots.findIndex((dot) => Number.parseFloat(getComputedStyle(dot).width) >= 15)
        : -1,
    };
  })()`);
}

async function assertHomeCarouselAccessibility(cards, selectedPage, description) {
  const state = await readHomeCarouselState();
  assert(state, `${description}: the Home carousel is missing.`);
  const expectedIndicatorCount = cards.length > 1 ? cards.length : 0;
  const expectedActivePage = cards.length > 1 ? selectedPage : -1;
  const expectedIndicatorPresent = cards.length > 1;
  assert(
    state.activePage === expectedActivePage,
    expectedActivePage === -1
      ? `${description}: there should be no active page indicator.`
      : `${description}: expected active page ${expectedActivePage + 1}, found ${state.activePage + 1}.`,
  );
  assert(
    state.indicatorPresent === expectedIndicatorPresent,
    `${description}: expected page indicators to be ${expectedIndicatorPresent ? "present" : "absent"}.`,
  );
  assert(
    state.indicatorCount === expectedIndicatorCount,
    `${description}: expected ${expectedIndicatorCount} page indicators, found ${state.indicatorCount}.`,
  );
  assert(
    state.cards.length === cards.length,
    `${description}: expected ${cards.length} cards, found ${state.cards.length}.`,
  );
  for (const [index, expected] of cards.entries()) {
    const card = state.cards[index];
    assert(card.id === expected.id, `${description}: card ${index + 1} should be ${expected.id}.`);
    assert(
      card.label?.includes(expected.name) &&
        card.label.includes(`Position ${index + 1} of ${cards.length}`),
      `${description}: ${expected.id} needs its name and position in the accessible label; received ${JSON.stringify(card.label)}.`,
    );
    assert(card.role === 'button', `${description}: ${expected.id} should be one accessible button.`);
    assert(
      card.focusStops === 1,
      `${description}: ${expected.id} exposes ${card.focusStops} focus stops instead of one.`,
    );
  }
}

async function checkSingleHomeCarouselCard(width) {
  const description = `Single-card Home carousel at ${width}px`;
  const cards = [{ id: "starting-soon", name: "Starting at IST" }];

  await setViewport(width, 1, "home-carousel-preview.html?single-card=1");
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 1 && window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === null",
    `${description} to show one card without installing auto-advance`,
  );
  await assertHomeCarouselAccessibility(cards, 0, `${description} initial state`);

  const before = await readHomeCarouselState();
  await evaluate("window.__daily007HomeCarouselTest.clearAccessibilityAnnouncements()");
  await evaluate("window.__daily007HomeCarouselTest.setScreenReaderEnabled(true)");
  await waitForCondition(
    "window.__daily007HomeCarouselTest.getScreenReaderEnabled() && window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === null",
    `${description} to remain stationary with TalkBack enabled`,
  );
  const didAdvance = await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()");
  const after = await readHomeCarouselState();

  assert(!didAdvance, `${description} must not have an automatic page change.`);
  assert(
    before?.scrollLeft === after?.scrollLeft && after?.scrollLeft === 0,
    `${description} changed its scroll position: ${JSON.stringify({ before, after })}.`,
  );
  assert(
    (await evaluate("window.__daily007HomeCarouselTest.getAccessibilityAnnouncements().length")) === 0,
    `${description} announced a page change despite having only one match.`,
  );
  await assertHomeCarouselAccessibility(cards, 0, `${description} with TalkBack enabled`);
  const beforeActivation = await readHomeCarouselState();
  assert(
    beforeActivation?.scrollLeft === 0 &&
      beforeActivation.cards[0]?.id === "starting-soon" &&
      beforeActivation.cards[0]?.label?.includes("Position 1 of 1"),
    `${description} changed the selected card or its position label before activation: ${JSON.stringify(beforeActivation)}.`,
  );
  const navigationsBeforeActivation = await evaluate("globalThis.__previewNavigations ?? []");
  assert(
    navigationsBeforeActivation.length === 0,
    `${description} navigated before the one-card button was activated.`,
  );
  await assertHomeCarouselCardOpens(
    "starting-soon",
    `${description} TalkBack button`,
  );
  const navigationsAfterActivation = await evaluate("globalThis.__previewNavigations ?? []");
  assert(
    JSON.stringify(navigationsAfterActivation) ===
      JSON.stringify([["TDetail", { id: "starting-soon" }]]),
    `${description} should open the matching tournament details exactly once.`,
  );
  console.log(
    `PASS — ${description}: accessible name includes 1 of 1, one focus stop, no page indicator or auto-advance, and activation opens its matching details.`,
  );
}

function assertHomeCarouselNativeSelectedStateIsPassedThrough() {
  const homeSource = readFileSync(
    path.join(workspaceRoot, "artifacts/daily007/src/screens/Home.tsx"),
    "utf8",
  );
  const cardSource = readFileSync(
    path.join(workspaceRoot, "artifacts/daily007/src/components/ui.tsx"),
    "utf8",
  );
  assert(
    /accessibilityState=\{\{\s*selected\s*\}\}/.test(homeSource),
    "Home cards must expose their current page through the native selected accessibility state.",
  );
  assert(
    /accessibilityState=\{accessibilityState\}/.test(cardSource),
    "GCard must pass the native selected accessibility state to its Pressable.",
  );
}

async function checkHomeCarouselTalkBackNavigation(cards, width, description) {
  await assertHomeCarouselAccessibility(cards, 0, `${description} initial state`);
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.getScreenReaderListenerCount() > 0 && window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === 3500",
    `${description} to initialize screen-reader and carousel controls`,
  );
  await evaluate("window.__daily007HomeCarouselTest.clearAccessibilityAnnouncements()");
  await evaluate("window.__daily007HomeCarouselTest.setScreenReaderEnabled(true)");
  await waitForCondition(
    "window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === null",
    `${description} to pause automatic page changes while TalkBack is enabled`,
  );

  let expectedAnnouncementCount = 0;
  for (let index = 1; index < cards.length; index += 1) {
    await swipeHomeCarousel("left", `${description} page ${index + 1}`);
    await waitForHomeCarouselCard(cards[index].id, index, width, `${description} page ${index + 1}`);
    await assertHomeCarouselAccessibility(cards, index, `${description} page ${index + 1}`);
    expectedAnnouncementCount += 1;
    await waitForCondition(
      `window.__daily007HomeCarouselTest.getAccessibilityAnnouncements().length === ${expectedAnnouncementCount}`,
      `${description} to announce page ${index + 1} once`,
    );
    const announcements = await evaluate("window.__daily007HomeCarouselTest.getAccessibilityAnnouncements()");
    assert(
      announcements.at(-1) ===
        `Selected Upcoming match: ${cards[index].name}. Match ${index + 1} of ${cards.length}.`,
      `${description} announced the wrong match or position: ${JSON.stringify(announcements)}`,
    );
  }

  assert(
    await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()") === false,
    `${description} should not auto-advance while TalkBack is enabled.`,
  );
  await assertHomeCarouselAccessibility(cards, cards.length - 1, `${description} while TalkBack is enabled`);

  for (let index = cards.length - 2; index >= 0; index -= 1) {
    await swipeHomeCarousel("right", `${description} page ${index + 1}`);
    await waitForHomeCarouselCard(cards[index].id, index, width, `${description} page ${index + 1}`);
    await assertHomeCarouselAccessibility(cards, index, `${description} page ${index + 1}`);
    expectedAnnouncementCount += 1;
    await waitForCondition(
      `window.__daily007HomeCarouselTest.getAccessibilityAnnouncements().length === ${expectedAnnouncementCount}`,
      `${description} to announce page ${index + 1} once`,
    );
  }

  await evaluate("window.__daily007HomeCarouselTest.setScreenReaderEnabled(false)");
  await waitForCondition(
    "window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === 3500",
    `${description} to resume automatic page changes after TalkBack is disabled`,
  );
  await evaluate("window.__daily007HomeCarouselTest.clearAccessibilityAnnouncements()");
}

async function checkHomeCarouselLargeText(width, fontScale) {
  const names = [
    "Daily007 Grand Championship: Clash Squad Finals for the International Winter Festival",
    "Daily007 International Champions Cup: Battle Royale Solo Qualifier Round",
    "Daily007 Weekend Custom Showdown: Team Challenge for the Global Player Championship",
  ];
  const cards = [
    { id: "starting-soon", name: names[0] },
    { id: "later-one", name: names[1] },
    { id: "later-two", name: names[2] },
  ];
  const description = `Long-name Home carousel at ${width}px and ${fontScale}× Android text scale`;

  await setViewport(width, fontScale, "home-carousel-preview.html?long-names=1");
  assert(
    await evaluate(`window.__daily007LargeTextScale === ${fontScale}`),
    `${description} did not apply its requested Android text scale.`,
  );
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    `${description} to load all three long-name cards`,
  );
  await assertHomeCarouselAccessibility(cards, 0, `${description} initial state`);

  const layout = await evaluate(`(() => {
    const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
    if (!carousel) return null;
    const viewport = carousel.getBoundingClientRect();
    const cards = [...carousel.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    return {
      viewport: { left: viewport.left, right: viewport.right, width: carousel.clientWidth },
      scrollLeft: carousel.scrollLeft,
      cards: cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const page = card.parentElement?.getBoundingClientRect();
        const title = card.querySelector('[data-testid^="home-upcoming-title-"]');
        const titleWordRects = [];
        if (title) {
          const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
          const wordRange = document.createRange();
          let textNode;
          while ((textNode = walker.nextNode())) {
            for (const match of textNode.textContent.matchAll(/\\S+/g)) {
              wordRange.setStart(textNode, match.index);
              wordRange.setEnd(textNode, match.index + match[0].length);
              titleWordRects.push(...[...wordRange.getClientRects()].map((word) => ({
                left: word.left,
                right: word.right,
                top: word.top,
                bottom: word.bottom,
                width: word.width,
                height: word.height,
              })));
            }
          }
        }
        const titleBounds = title?.getBoundingClientRect();
        const titleScrollableAncestor = (() => {
          let ancestor = title?.parentElement;
          while (ancestor && ancestor !== document.body) {
            const overflowY = getComputedStyle(ancestor).overflowY;
            if (
              (overflowY === 'auto' || overflowY === 'scroll') &&
              ancestor.scrollHeight > ancestor.clientHeight + 1
            ) {
              const ancestorBounds = ancestor.getBoundingClientRect();
              return {
                canScrollToTitle: titleBounds
                  ? titleBounds.bottom - ancestorBounds.top <=
                      ancestor.clientHeight + ancestor.scrollHeight - ancestor.clientHeight + 1
                  : false,
              };
            }
            ancestor = ancestor.parentElement;
          }
          return null;
        })();
        return {
          id: card.getAttribute('data-testid')?.replace('home-upcoming-card-', ''),
          label: card.getAttribute('aria-label'),
          titleText: title?.textContent?.trim() ?? null,
          titleBounds: titleBounds
            ? { left: titleBounds.left, right: titleBounds.right, top: titleBounds.top, bottom: titleBounds.bottom }
            : null,
          titleWordRects,
          titleTextBox: title
            ? {
                clientWidth: title.clientWidth,
                scrollWidth: title.scrollWidth,
                clientHeight: title.clientHeight,
                scrollHeight: title.scrollHeight,
              }
            : null,
          titleScrollableAncestor,
          card: {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
            clientWidth: card.clientWidth,
            scrollWidth: card.scrollWidth,
            clientHeight: card.clientHeight,
            scrollHeight: card.scrollHeight,
          },
          page: page
            ? { left: page.left, right: page.right, width: page.width }
            : null,
        };
      }),
    };
  })()`);

  assert(layout, `${description}: the carousel layout is missing.`);
  assert(
    layout.viewport.width === width && layout.scrollLeft < 1,
    `${description}: expected the first page at ${width}px, received ${JSON.stringify(layout.viewport)} with scrollLeft ${layout.scrollLeft}.`,
  );
  assert(
    layout.cards.length === cards.length,
    `${description}: expected ${cards.length} cards, received ${layout.cards.length}.`,
  );
  for (const [index, expected] of cards.entries()) {
    const actual = layout.cards[index];
    assert(
      actual.id === expected.id && actual.titleText === expected.name,
      `${description}: ${expected.id} lost its complete visible title: ${JSON.stringify(actual)}.`,
    );
    assert(
      actual.page?.width === width &&
        actual.card.left >= actual.page.left - 1 &&
        actual.card.right <= actual.page.right + 1,
      `${description}: ${expected.id} escapes its carousel page: ${JSON.stringify(actual)}.`,
    );
    assert(
      actual.card.scrollWidth <= actual.card.clientWidth + 2 &&
        actual.card.scrollHeight <= actual.card.clientHeight + 2,
      `${description}: ${expected.id} clips or overflows content: ${JSON.stringify(actual.card)}.`,
    );
    assert(
      actual.titleWordRects.length >= expected.name.split(/\\s+/).length &&
        actual.titleBounds.left >= actual.card.left - 1 &&
        actual.titleBounds.right <= actual.card.right + 1 &&
        actual.titleBounds.top >= actual.card.top - 1 &&
        actual.titleBounds.bottom <= actual.card.bottom + 1 &&
        actual.titleTextBox.scrollWidth <= actual.titleTextBox.clientWidth + 2 &&
        actual.titleTextBox.scrollHeight <= actual.titleTextBox.clientHeight + 2 &&
        actual.titleWordRects.every((word) =>
          word.width > 0 &&
          word.height > 0 &&
          word.left >= actual.card.left - 1 &&
          word.right <= actual.card.right + 1 &&
          word.top >= actual.card.top - 1 &&
          word.bottom <= actual.card.bottom + 1
        ),
      `${description}: ${expected.id} title is hidden or escapes the card bounds: ${JSON.stringify(actual)}.`,
    );
    assert(
      actual.titleScrollableAncestor?.canScrollToTitle,
      `${description}: ${expected.id} title cannot be brought into the visible Home scroll area: ${JSON.stringify(actual.titleScrollableAncestor)}.`,
    );
    if (index > 0) {
      const previous = layout.cards[index - 1];
      assert(
        previous.card.right <= actual.card.left + 1,
        `${description}: ${previous.id} overlaps or hides ${actual.id}: ${JSON.stringify([previous.card, actual.card])}.`,
      );
    }
  }

  await checkHomeCarouselTalkBackNavigation(cards, width, description);
  console.log(
    `PASS — Home carousel long names, positions, single-stop TalkBack labels, and non-overlapping card bounds at ${width}px and ${fontScale}× text.`,
  );
}

async function waitForHomeCarouselCard(id, pageIndex, width, description) {
  const selector = `[data-testid="home-upcoming-card-${id}"]`;
  try {
    await waitForCondition(`(() => {
      const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
      const card = document.querySelector(${JSON.stringify(selector)});
      const dots = [...document.querySelectorAll('[data-testid^="home-upcoming-page-dot-"]')];
      const activePage = dots.findIndex((dot) => Number.parseFloat(getComputedStyle(dot).width) >= 15);
      if (!carousel || !card || activePage !== ${pageIndex}) return false;
      const viewport = carousel.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1;
    })()`, `${description} to be fully visible at page ${pageIndex + 1}`);
  } catch (error) {
    const state = await readHomeCarouselState();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; carousel state: ${JSON.stringify(state)}`,
    );
  }

  const state = await readHomeCarouselState();
  assert(state, `The Home carousel could not be inspected at ${width}px.`);
  assert(
    state.indicatorCount === state.cards.length,
    `The Home page indicators do not match its ${state.cards.length} cards at ${width}px.`,
  );
  assert(state.activePage === pageIndex, `${description} is not the selected page at ${width}px.`);
  const card = state.cards.find((item) => item.id === id);
  assert(card, `${description} is missing from the Home carousel at ${width}px.`);
  assert(
    card.left >= state.viewport.left - 1 && card.right <= state.viewport.right + 1,
    `${description} is clipped at ${width}px (card ${card.left}–${card.right}, viewport ${state.viewport.left}–${state.viewport.right}).`,
  );
  assert(
    card.scrollWidth <= card.clientWidth + 2,
    `${description} has horizontally clipped content at ${width}px.`,
  );
  return state;
}

async function assertHomeCarouselSelectionSurvivesRotation(id, pageIndex, cardCount, portraitWidth, listDescription) {
  const pageLoadTime = await evaluate("performance.timeOrigin");
  const assertSelectedState = (state, viewportWidth, orientation) => {
    assert(state, `The ${listDescription} Home carousel is missing in ${orientation}.`);
    assert(
      state.viewport.width === viewportWidth,
      `The Home carousel viewport should be ${viewportWidth}px in ${orientation}, received ${state.viewport.width}px.`,
    );
    assert(
      state.cards.length === cardCount && state.indicatorCount === cardCount,
      `The ${listDescription} should retain ${cardCount} cards and indicators in ${orientation}: ${JSON.stringify(state)}.`,
    );
    assert(
      state.cards[pageIndex]?.id === id && state.activePage === pageIndex,
      `${listDescription} should keep ${id} selected with page ${pageIndex + 1} active in ${orientation}: ${JSON.stringify(state)}.`,
    );
  };

  const portraitState = await waitForHomeCarouselCard(
    id,
    pageIndex,
    portraitWidth,
    `${listDescription} before rotation`,
  );
  assertSelectedState(portraitState, portraitWidth, "portrait");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 800,
    height: 360,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitForCondition(
    "window.innerWidth === 800 && window.innerHeight === 360",
    `the ${listDescription} Home preview to rotate to 800×360 without reloading`,
  );
  const landscapeState = await waitForHomeCarouselCard(
    id,
    pageIndex,
    800,
    `${listDescription} after rotation`,
  );
  assertSelectedState(landscapeState, 800, "landscape");
  assert(
    await evaluate(`performance.timeOrigin === ${JSON.stringify(pageLoadTime)}`),
    `The Home preview reloaded during the ${listDescription} landscape resize.`,
  );

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: portraitWidth,
    height: 820,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitForCondition(
    `window.innerWidth === ${portraitWidth} && window.innerHeight === 820`,
    `the ${listDescription} Home preview to return to ${portraitWidth}×820 without reloading`,
  );
  const returnedState = await waitForHomeCarouselCard(
    id,
    pageIndex,
    portraitWidth,
    `${listDescription} after returning to portrait`,
  );
  assertSelectedState(returnedState, portraitWidth, "portrait after returning");
  assert(
    await evaluate(`performance.timeOrigin === ${JSON.stringify(pageLoadTime)}`),
    `The Home preview reloaded while returning from the ${listDescription} landscape resize.`,
  );
  console.log(
    `PASS Home carousel rotation — ${id} stays on page ${pageIndex + 1} with a fully visible card and synchronized indicator for the ${listDescription} at ${portraitWidth}px and 800px.`,
  );
}

async function assertHomeCarouselCardOpens(id, description) {
  await tapSelector(`[data-testid="home-upcoming-card-${id}"]`, description);
  const navigations = await evaluate("globalThis.__previewNavigations ?? []");
  assert(
    JSON.stringify(navigations.at(-1)) === JSON.stringify(["TDetail", { id }]),
    `${description} opened the wrong tournament details: ${JSON.stringify(navigations.at(-1))}.`,
  );
}

async function checkHomeRetryRecovery() {
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    "Home to load its initial tournament cards",
  );
  const countsBeforeJoin = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "The initial Home refresh should be available.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeJoin.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeJoin.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to display a joined tournament card before the retry scenario",
  );

  await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', {
    name: 'Latest Tournament From Home Retry'
  })`);
  await evaluate("window.__daily007HomeCarouselTest.setRegistrations([])");
  await evaluate("window.__daily007HomeCarouselTest.failNextRegistrationRead('Home retry setup failed')");
  const countsBeforeStaleWarning = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "Home should allow a refresh to fail.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeStaleWarning.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeStaleWarning.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText.includes('Home retry setup failed') &&
      Boolean(document.querySelector('[data-testid="home-upcoming-retry"]'))`,
    "Home to show a retryable stale-data warning while retaining the joined card",
  );
  const staleCardNodes = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    window.__daily007HomeCarouselTest.retryStaleCardNodes = cards;
    return cards.map((card) => card.innerText);
  })()`);
  assert(
    staleCardNodes.length === 3 &&
      staleCardNodes[1].includes("JOINED") &&
      !staleCardNodes[1].includes("Latest Tournament From Home Retry"),
    `The initial refresh failure must leave all three cached cards and the prior joined card intact: ${JSON.stringify(staleCardNodes)}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  await evaluate("window.__daily007HomeCarouselTest.failNextTournamentRead('Home tournament-list retry failed')");
  const countsBeforeTournamentRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await tapSelector(
    '[data-testid="home-upcoming-retry"]',
    "Home's visible retry after a registration refresh failure",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeTournamentRetry.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeTournamentRetry.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText.includes('Home tournament-list retry failed') &&
      Boolean(document.querySelector('[data-testid="home-upcoming-retry"]'))`,
    "Home to finish the retry with a failed tournament read and successful registration read",
  );
  const tournamentRetryFailureState = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    return {
      cardTexts: cards.map((card) => card.innerText),
      cardNodesRetained: window.__daily007HomeCarouselTest.retryStaleCardNodes?.every(
        (card, index) => card === cards[index],
      ) ?? false,
      warningText: document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText ?? null,
      retryVisible: Boolean(document.querySelector('[data-testid="home-upcoming-retry"]')),
    };
  })()`);
  assert(
    tournamentRetryFailureState.cardTexts.length === 3 &&
      tournamentRetryFailureState.cardTexts[1].includes("JOINED") &&
      !tournamentRetryFailureState.cardTexts[1].includes("Latest Tournament From Home Retry") &&
      tournamentRetryFailureState.cardNodesRetained &&
      tournamentRetryFailureState.warningText?.includes("Home tournament-list retry failed") &&
      tournamentRetryFailureState.retryVisible,
    `A failed tournament-list retry must retain the last good joined cards and leave the warning and retry available: ${JSON.stringify(tournamentRetryFailureState)}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  await evaluate("window.__daily007HomeCarouselTest.deferNextRegistrationRead()");
  const countsBeforeVisibleRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await tapSelector('[data-testid="home-upcoming-retry"]', "Home's visible retry button");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeVisibleRetry.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeVisibleRetry.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-retry"]')?.innerText.includes('RETRYING')`,
    "The visible Home retry to start exactly one paired refresh and remain pending",
  );
  const pendingRetryState = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    return {
      cardTexts: cards.map((card) => card.innerText),
      cardNodesRetained: window.__daily007HomeCarouselTest.retryStaleCardNodes?.every(
        (card, index) => card === cards[index],
      ) ?? false,
      warningVisible: Boolean(document.querySelector('[data-testid="home-upcoming-refresh-error"]')),
      retryText: document.querySelector('[data-testid="home-upcoming-retry"]')?.innerText ?? null,
    };
  })()`);
  assert(
    pendingRetryState.cardTexts.length === 3 &&
      pendingRetryState.cardTexts[1].includes("JOINED") &&
      !pendingRetryState.cardTexts[1].includes("Latest Tournament From Home Retry") &&
      pendingRetryState.cardNodesRetained &&
      pendingRetryState.warningVisible &&
      pendingRetryState.retryText?.includes("RETRYING"),
    `While the paired retry is pending, Home must retain its cached joined cards and stale-data warning: ${JSON.stringify(pendingRetryState)}.`,
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.releaseRegistrationRead()"),
    "The pending Home retry's registration response should be released.",
  );
  await waitForCondition(
    `document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('Latest Tournament From Home Retry') &&
      document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED') &&
      !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "The successful visible retry to apply the latest joined card and clear the warning",
  );
  const countsAfterVisibleRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    countsAfterVisibleRetry.tournaments === countsBeforeVisibleRetry.tournaments + 1 &&
      countsAfterVisibleRetry.registrations === countsBeforeVisibleRetry.registrations + 1,
    `The visible retry should perform only one read per endpoint: ${JSON.stringify({
      before: countsBeforeVisibleRetry,
      after: countsAfterVisibleRetry,
    })}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', {
    name: 'Tournament After A Later Failed Refresh'
  })`);
  await evaluate("window.__daily007HomeCarouselTest.setRegistrations([])");
  await evaluate("window.__daily007HomeCarouselTest.failNextRegistrationRead('A later Home refresh failed')");
  const countsBeforeLaterFailure = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "Home should allow another refresh after recovery.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeLaterFailure.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeLaterFailure.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText.includes('A later Home refresh failed')`,
    "A later Home refresh failure to restore the stale-data warning",
  );
  const laterFailureState = await evaluate(`(() => ({
    cardText: document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText ?? null,
    warningText: document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText ?? null,
    retryVisible: Boolean(document.querySelector('[data-testid="home-upcoming-retry"]')),
  }))()`);
  assert(
    laterFailureState.cardText?.includes("Latest Tournament From Home Retry") &&
      laterFailureState.cardText.includes("JOINED") &&
      !laterFailureState.cardText.includes("Tournament After A Later Failed Refresh") &&
      laterFailureState.warningText?.includes("cards shown may be out of date") &&
      laterFailureState.warningText.includes("A later Home refresh failed") &&
      laterFailureState.retryVisible,
    `A later refresh failure must preserve the last successful cards and keep the warning and retry available: ${JSON.stringify(laterFailureState)}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', {
    name: 'Latest Tournament After Second Retry'
  })`);
  await evaluate("window.__daily007HomeCarouselTest.setRegistrations([])");
  await evaluate("window.__daily007HomeCarouselTest.deferNextTournamentRead()");
  await evaluate("window.__daily007HomeCarouselTest.deferNextRegistrationRead()");
  await evaluate(`(() => {
    window.__daily007HomeCarouselTest.secondRetryStaleCardNodes = [
      ...document.querySelectorAll('[data-testid^="home-upcoming-card-"]'),
    ];
  })()`);
  const countsBeforeSecondVisibleRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await tapSelector('[data-testid="home-upcoming-retry"]', "Home's retry after a second connection failure");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${countsBeforeSecondVisibleRetry.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${countsBeforeSecondVisibleRetry.registrations + 1} &&
      document.querySelector('[data-testid="home-upcoming-retry"]')?.innerText.includes('RETRYING')`,
    "the second visible Home retry to start exactly one paired refresh and remain pending",
  );
  const pendingSecondRetryState = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    return {
      cardTexts: cards.map((card) => card.innerText),
      cardNodesRetained: window.__daily007HomeCarouselTest.secondRetryStaleCardNodes?.every(
        (card, index) => card === cards[index],
      ) ?? false,
      warningText: document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText ?? null,
      retryText: document.querySelector('[data-testid="home-upcoming-retry"]')?.innerText ?? null,
    };
  })()`);
  assert(
    pendingSecondRetryState.cardTexts.length === 3 &&
      pendingSecondRetryState.cardTexts[1].includes("JOINED") &&
      !pendingSecondRetryState.cardTexts[1].includes("Latest Tournament After Second Retry") &&
      pendingSecondRetryState.cardNodesRetained &&
      pendingSecondRetryState.warningText?.includes("A later Home refresh failed") &&
      pendingSecondRetryState.retryText?.includes("RETRYING"),
    `While the second retry is pending, Home must retain cached joined cards and the warning: ${JSON.stringify(pendingSecondRetryState)}.`,
  );
  const countsDuringSecondVisibleRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    countsDuringSecondVisibleRetry.tournaments === countsBeforeSecondVisibleRetry.tournaments + 1 &&
      countsDuringSecondVisibleRetry.registrations === countsBeforeSecondVisibleRetry.registrations + 1,
    `The second retry should start only one request for each endpoint: ${JSON.stringify({
      before: countsBeforeSecondVisibleRetry,
      during: countsDuringSecondVisibleRetry,
    })}.`,
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.resolveDeferredTournamentRead()"),
    "The second retry's tournament response should be released.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.releaseRegistrationRead()"),
    "The second retry's registration response should be released.",
  );
  await waitForCondition(
    `document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('Latest Tournament After Second Retry') &&
      !document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED') &&
      !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "the second successful retry to update the cached card and clear the warning",
  );
  const countsAfterSecondVisibleRetry = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    countsAfterSecondVisibleRetry.tournaments === countsBeforeSecondVisibleRetry.tournaments + 1 &&
      countsAfterSecondVisibleRetry.registrations === countsBeforeSecondVisibleRetry.registrations + 1,
    `No duplicate tournament or registration request should start during the second retry: ${JSON.stringify({
      before: countsBeforeSecondVisibleRetry,
      after: countsAfterSecondVisibleRetry,
    })}.`,
  );
  console.log("PASS — Home retries recover after repeated failures; tournament-list and registration errors preserve cached joined cards, and successful retries update data and clear warnings.");
}

async function checkHomeRefreshOverlap() {
  await setViewport(390, 1, "home-carousel-preview.html?manual-refresh-only=1");
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    "Home's initial cards and manual refresh control",
  );
  const initialCounts = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(initialCounts.tournaments === 1 && initialCounts.registrations === 1, "Home must begin with one initial request pair.");

  await evaluate("window.__daily007HomeCarouselTest.deferNextTournamentRead()");
  await evaluate("window.__daily007HomeCarouselTest.deferNextRegistrationRead()");
  await tapSelector('[data-testid="player-refresh-control-test-action"]', "Home's manual refresh control");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${initialCounts.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${initialCounts.registrations + 1}`,
    "the held manual request pair",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home's periodic refresh callback should be available during the manual refresh.",
  );
  await evaluate(`(() => {
    const test = window.__daily007HomeCarouselTest;
    test.setHomeAppState("background");
    test.setHomeAppState("active");
  })()`);
  await delay(100);
  const heldCounts = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    heldCounts.tournaments === initialCounts.tournaments + 1 &&
      heldCounts.registrations === initialCounts.registrations + 1,
    `Manual, periodic, and resume triggers must share one in-flight API pair: ${JSON.stringify(heldCounts)}.`,
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.resolveDeferredTournamentRead()"),
    "The held tournament request should resolve.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.releaseRegistrationRead()"),
    "The held registration request should resolve.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${initialCounts.tournaments + 2} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${initialCounts.registrations + 2} &&
      !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "one queued resume refresh to run after the manual request settles",
  );

  const beforeFailedPoll = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.deferNextTournamentRead()");
  await evaluate("window.__daily007HomeCarouselTest.deferNextRegistrationRead()");
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "A later periodic refresh should be available for the failure case.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${beforeFailedPoll.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${beforeFailedPoll.registrations + 1}`,
    "the held periodic request pair for the failure case",
  );
  await tapSelector('[data-testid="player-refresh-control-test-action"]', "manual refresh during the held poll");
  await evaluate(`(() => {
    const test = window.__daily007HomeCarouselTest;
    test.setHomeAppState("background");
    test.setHomeAppState("active");
  })()`);
  await delay(100);
  const failedPairCounts = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    failedPairCounts.tournaments === beforeFailedPoll.tournaments + 1 &&
      failedPairCounts.registrations === beforeFailedPoll.registrations + 1,
    `Overlapping triggers during the held poll must not duplicate its requests: ${JSON.stringify(failedPairCounts)}.`,
  );
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.failDeferredTournamentRead("Held Home tournament request failed")`),
    "The held tournament request should reject for the failure case.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.releaseRegistrationRead()"),
    "The paired registration request should settle despite its partner failing.",
  );
  await waitForCondition(
    `document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText.includes("Held Home tournament request failed")`,
    "Home to show the paired refresh failure while retaining its cards",
  );

  await tapSelector('[data-testid="player-refresh-control-test-action"]', "Home refresh after a failed pair");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${beforeFailedPoll.tournaments + 2} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${beforeFailedPoll.registrations + 2} &&
      !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "a later manual refresh to run and recover after the failed pair",
  );
  console.log("PASS — Manual, periodic, and resume triggers share one held request pair, queue at most one resume refresh, and refresh again after a failed pair.");
}

async function checkHomeQueuedRefreshWhenAway() {
  await setViewport(390, 1, "home-carousel-preview.html?manual-refresh-only=1&resume-while-refresh-only=1");
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    "Home's initial cards and manual refresh control",
  );
  const initial = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  const test = "window.__daily007HomeCarouselTest";

  await evaluate(`${test}.deferNextTournamentRead()`);
  await evaluate(`${test}.deferNextRegistrationRead()`);
  await tapSelector('[data-testid="player-refresh-control-test-action"]', "Home's manual refresh control");
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${initial.tournaments + 1} && ${test}.getMyRegistrationReadCount() === ${initial.registrations + 1}`,
    "the held Home request pair before navigating away",
  );
  await evaluate(`${test}.setHomeAppState("background"); ${test}.setHomeAppState("active");`);
  await evaluate(`${test}.blurHome()`);
  await delay(100);
  const stillBlurredCounts = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  assert(
    stillBlurredCounts.tournaments === initial.tournaments + 1 &&
      stillBlurredCounts.registrations === initial.registrations + 1,
    `Blurring Home must discard the queued follow-up: ${JSON.stringify(stillBlurredCounts)}.`,
  );
  assert(await evaluate(`${test}.resolveDeferredTournamentRead()`), "The in-flight tournament request should remain resolvable while Home is blurred.");
  assert(await evaluate(`${test}.releaseRegistrationRead()`), "The in-flight registration request should remain resolvable while Home is blurred.");
  await delay(120);
  const awayCounts = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  assert(
    awayCounts.tournaments === initial.tournaments + 1 &&
      awayCounts.registrations === initial.registrations + 1,
    `The queued follow-up must not start after Home loses focus: ${JSON.stringify(awayCounts)}.`,
  );
  await evaluate(`${test}.focusHome()`);
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${initial.tournaments + 2} &&
      ${test}.getMyRegistrationReadCount() === ${initial.registrations + 2}`,
    "Home to refresh normally when it is focused again",
  );

  const beforeQuickRefocus = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  await evaluate(`${test}.deferNextTournamentRead()`);
  await evaluate(`${test}.deferNextRegistrationRead()`);
  await tapSelector('[data-testid="player-refresh-control-test-action"]', "Home's manual refresh control before a quick refocus");
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${beforeQuickRefocus.tournaments + 1} &&
      ${test}.getMyRegistrationReadCount() === ${beforeQuickRefocus.registrations + 1}`,
    "the held Home request pair before a quick blur and refocus",
  );
  await evaluate(`${test}.setHomeAppState("background"); ${test}.setHomeAppState("active"); ${test}.blurHome(); ${test}.focusHome();`);
  await delay(100);
  const quickRefocusCounts = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  assert(
    quickRefocusCounts.tournaments === beforeQuickRefocus.tournaments + 1 &&
      quickRefocusCounts.registrations === beforeQuickRefocus.registrations + 1,
    `A quick refocus must defer one follow-up instead of overlapping the held pair: ${JSON.stringify(quickRefocusCounts)}.`,
  );
  assert(await evaluate(`${test}.resolveDeferredTournamentRead()`), "The held tournament request should remain active after the quick refocus.");
  assert(await evaluate(`${test}.releaseRegistrationRead()`), "The held registration request should remain active after the quick refocus.");
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${beforeQuickRefocus.tournaments + 2} &&
      ${test}.getMyRegistrationReadCount() === ${beforeQuickRefocus.registrations + 2}`,
    "one follow-up refresh to run after Home quickly regains focus",
  );

  const beforeBackground = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  await evaluate(`${test}.deferNextTournamentRead()`);
  await evaluate(`${test}.deferNextRegistrationRead()`);
  await tapSelector('[data-testid="player-refresh-control-test-action"]', "Home's manual refresh control before backgrounding");
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${beforeBackground.tournaments + 1} &&
      ${test}.getMyRegistrationReadCount() === ${beforeBackground.registrations + 1}`,
    "the held Home request pair before app backgrounding",
  );
  await evaluate(`${test}.setHomeAppState("background"); ${test}.setHomeAppState("active"); ${test}.setHomeAppState("background");`);
  assert(await evaluate(`${test}.resolveDeferredTournamentRead()`), "The in-flight tournament request should settle while the app is inactive.");
  assert(await evaluate(`${test}.releaseRegistrationRead()`), "The in-flight registration request should settle while the app is inactive.");
  await delay(120);
  const inactiveCounts = await evaluate(`({
    tournaments: ${test}.getTournamentReadCount(),
    registrations: ${test}.getMyRegistrationReadCount(),
  })`);
  assert(
    inactiveCounts.tournaments === beforeBackground.tournaments + 1 &&
      inactiveCounts.registrations === beforeBackground.registrations + 1,
    `The queued follow-up must not start while the app is inactive: ${JSON.stringify(inactiveCounts)}.`,
  );
  await evaluate(`${test}.setHomeAppState("active")`);
  await waitForCondition(
    `${test}.getTournamentReadCount() === ${beforeBackground.tournaments + 2} &&
      ${test}.getMyRegistrationReadCount() === ${beforeBackground.registrations + 2}`,
    "Home to refresh normally when the app becomes active again",
  );
  console.log("PASS — A queued Home refresh is skipped after blur or backgrounding, while the active request settles and Home refreshes again on return.");
}

async function checkHomeInitialLoadRetry() {
  const scenarios = [
    {
      name: "tournament request failure",
      query: "tournament",
      error: "Initial Home tournament request failed.",
      expectedCard: "Starting at IST",
    },
    {
      name: "registration request failure with no upcoming matches",
      query: "registration-empty",
      error: "Initial Home registration request failed.",
      empty: true,
    },
  ];

  for (const scenario of scenarios) {
    await setViewport(
      390,
      1,
      `home-carousel-preview.html?home-initial-retry=${scenario.query}`,
    );
    await waitForCondition(
      `window.__daily007HomeCarouselTest?.ready === true &&
        Boolean(document.querySelector('[data-testid="home-empty-load-error"]')) &&
        Boolean(document.querySelector('[data-testid="home-empty-retry"]'))`,
      `Home to show the initial ${scenario.name}`,
    );
    const initialState = await evaluate(`(() => ({
      error: document.querySelector('[data-testid="home-empty-load-error"]')?.innerText ?? "",
      tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
      registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
      cards: document.querySelectorAll('[data-testid^="home-upcoming-card-"]').length,
    }))()`);
    assert(
      initialState.error.includes(scenario.error) &&
        initialState.tournaments === 1 &&
        initialState.registrations === 1 &&
        initialState.cards === 0,
      `Initial ${scenario.name} should show a retryable error with no cards and one request pair: ${JSON.stringify(initialState)}.`,
    );

    await tapSelector('[data-testid="home-empty-retry"]', `Home retry after ${scenario.name}`);
    await waitForCondition(
      scenario.empty
        ? `window.__daily007HomeCarouselTest.getTournamentReadCount() === 2 &&
          window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === 2 &&
          !document.querySelector('[data-testid="home-empty-load-error"]') &&
          document.body.innerText.includes("No upcoming tournaments are available right now.")`
        : `window.__daily007HomeCarouselTest.getTournamentReadCount() === 2 &&
          window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === 2 &&
          !document.querySelector('[data-testid="home-empty-load-error"]') &&
          Boolean(document.querySelector('[data-testid="home-upcoming-card-starting-soon"]'))`,
      `Home to recover after ${scenario.name}`,
    );
    const recoveredState = await evaluate(`(() => ({
      errorVisible: Boolean(document.querySelector('[data-testid="home-empty-load-error"]')),
      cards: [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')]
        .map((card) => card.innerText),
      body: document.body.innerText,
    }))()`);
    assert(
      !recoveredState.errorVisible &&
        (scenario.empty
          ? recoveredState.cards.length === 0 &&
            recoveredState.body.includes("No upcoming tournaments are available right now.") &&
            recoveredState.body.includes("CHECK MATCHES")
          : recoveredState.cards.some((card) => card.includes(scenario.expectedCard))),
      `Successful retry should clear the failure and show the correct ${scenario.empty ? "normal empty state" : "upcoming cards"}: ${JSON.stringify(recoveredState)}.`,
    );

    if (scenario.empty) {
      const clicked = await evaluate(`(() => {
        const action = [...document.querySelectorAll('[role="button"], button')]
          .find((button) => button.textContent?.includes("CHECK MATCHES"));
        if (!action) return false;
        action.click();
        return true;
      })()`);
      assert(clicked, "The normal empty-state CHECK MATCHES action should be available after recovery.");
      await delay(130);
      const navigations = await evaluate("globalThis.__previewNavigations ?? []");
      assert(
        JSON.stringify(navigations.at(-1)) === JSON.stringify(["Tournaments"]),
        `CHECK MATCHES should open the tournament list: ${JSON.stringify(navigations.at(-1))}.`,
      );
    }
  }
  console.log("PASS — Home recovers from either initial request failure; successful empty data clears the error and CHECK MATCHES opens Tournaments.");
}

async function checkHomeCarousel(width) {
  assertHomeCarouselNativeSelectedStateIsPassedThrough();
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
  const initialState = await readHomeCarouselState();
  assert(initialState, `The initial Home carousel is missing at ${width}px.`);
  assert(
    JSON.stringify(initialState.cards.map((card) => card.id)) ===
      JSON.stringify(["starting-soon", "later-one", "later-two"]),
    `The initial Home carousel skipped a tournament at ${width}px: ${JSON.stringify(initialState.cards.map((card) => card.id))}.`,
  );
  assert(initialState.activePage === 0, `The first Home carousel page is not selected at ${width}px.`);
  assert(
    await evaluate("window.__daily007HomeCarouselTest.getCarouselAutoAdvanceIntervalMs() === 3500"),
    `Home did not install the expected auto-advance interval at ${width}px.`,
  );
  await waitForHomeCarouselCard("starting-soon", 0, width, "The first Upcoming tournament");
  await checkHomeCarouselTalkBackNavigation(
    [
      { id: "starting-soon", name: "Starting at IST" },
      { id: "later-one", name: "Later Tournament One" },
      { id: "later-two", name: "Later Tournament Two" },
    ],
    width,
    `Three-card Home carousel at ${width}px`,
  );

  await swipeHomeCarousel("left", "the first Upcoming tournament");
  await waitForHomeCarouselCard("later-one", 1, width, "The second Upcoming tournament after a manual swipe");
  await assertHomeCarouselSelectionSurvivesRotation("later-one", 1, 3, width, "three-card list");
  const pageLoadTimeBeforeReorder = await evaluate("performance.timeOrigin");
  const readsBeforeReorder = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.setTournamentOrder([
      "starting-soon",
      "later-two",
      "later-one",
    ])`),
    "The Home preview should reorder the same tournament fixtures without removing any.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home's scheduled poll should refresh the reordered tournament fixtures.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeReorder.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeReorder.registrations + 1} &&
      [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')]
        .map((card) => card.getAttribute("data-testid").replace("home-upcoming-card-", ""))
        .join(",") === "starting-soon,later-two,later-one"`,
    "Home to refresh the same three tournaments in a different order",
  );
  await waitForHomeCarouselCard(
    "later-one",
    2,
    width,
    "The previously selected tournament after its card moves to page 3",
  );
  const reorderedState = await readHomeCarouselState();
  assert(
    reorderedState?.cards[2]?.id === "later-one" && reorderedState.activePage === 2,
    `Home should keep later-one selected and activate its new page after refresh: ${JSON.stringify(reorderedState)}.`,
  );
  assert(
    await evaluate(`performance.timeOrigin === ${JSON.stringify(pageLoadTimeBeforeReorder)}`),
    "The Home preview should preserve the selected tournament without reloading the screen.",
  );
  await assertHomeCarouselCardOpens(
    "later-one",
    "The previously selected tournament after the refreshed order changes",
  );
  const readsBeforeRestore = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.setTournamentOrder([
      "starting-soon",
      "later-one",
      "later-two",
    ])`),
    "The Home preview should restore its original tournament order after the reorder check.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home's scheduled poll should restore the original tournament order.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeRestore.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeRestore.registrations + 1} &&
      [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')]
        .map((card) => card.getAttribute("data-testid").replace("home-upcoming-card-", ""))
        .join(",") === "starting-soon,later-one,later-two"`,
    "Home to restore the original tournament order",
  );
  await waitForHomeCarouselCard(
    "later-one",
    1,
    width,
    "The selected tournament after the original order is restored",
  );
  await swipeHomeCarousel("left", "the second Upcoming tournament");
  await waitForHomeCarouselCard("later-two", 2, width, "The third Upcoming tournament after a manual swipe");
  await swipeHomeCarousel("right", "the third Upcoming tournament");
  await waitForHomeCarouselCard("later-one", 1, width, "The second Upcoming tournament after swiping back");
  await swipeHomeCarousel("right", "the second Upcoming tournament");
  await waitForHomeCarouselCard("starting-soon", 0, width, "The first Upcoming tournament after swiping back");

  await assertHomeCarouselCardOpens("starting-soon", "The first Upcoming tournament");
  for (const [page, id] of [[1, "later-one"], [2, "later-two"], [0, "starting-soon"]]) {
    const advanced = await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()");
    assert(advanced, `Home auto-advance was unavailable at ${width}px.`);
    await waitForHomeCarouselCard(id, page, width, `Auto-advance to ${id}`);
    await assertHomeCarouselCardOpens(id, `Auto-advanced tournament ${id}`);
  }

  await swipeHomeCarousel("left", "the first Upcoming tournament before the scheduled start");
  await waitForHomeCarouselCard(
    "later-one",
    1,
    width,
    "The second Upcoming tournament selected before the scheduled start",
  );
  await swipeHomeCarousel("left", "the second Upcoming tournament before the scheduled start");
  await waitForHomeCarouselCard(
    "later-two",
    2,
    width,
    "The last Upcoming tournament selected before the scheduled start",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.hasScheduledStartTimer()"),
    `Home did not schedule the tournament's start-time transition at ${width}px.`,
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.advancePastScheduledStart()"),
    `The controlled start-time transition could not run at ${width}px.`,
  );
  await waitForCondition(
    "window.__daily007HomeCarouselTest.didStartTimerFire() && window.__daily007HomeCarouselTest.getFakeNow() >= window.__daily007HomeCarouselTest.scheduledStartMs && !document.querySelector('[data-testid=\"home-upcoming-card-starting-soon\"]') && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 2",
    "Home to remove the tournament at its scheduled IST start",
  );
  await assertText("Later Tournament One");
  await assertText("Later Tournament Two");
  const remainingState = await readHomeCarouselState();
  assert(remainingState, `The remaining Home carousel is missing at ${width}px.`);
  assert(
    JSON.stringify(remainingState.cards.map((card) => card.id)) === JSON.stringify(["later-one", "later-two"]) &&
      remainingState.indicatorCount === 2 &&
      remainingState.activePage === 1,
    `Home did not preserve the selected later-two tournament at its new position and update the two-card indicator after the scheduled start at ${width}px: ${JSON.stringify(remainingState)}.`,
  );
  await waitForHomeCarouselCard("later-two", 1, width, "The selected tournament after the earlier start");
  await assertHomeCarouselCardOpens("later-two", "The selected tournament after the earlier start");
  await swipeHomeCarousel("right", "the selected tournament after the earlier start");
  await waitForHomeCarouselCard("later-one", 0, width, "The first remaining tournament");
  await checkHomeCarouselTalkBackNavigation(
    [
      { id: "later-one", name: "Later Tournament One" },
      { id: "later-two", name: "Later Tournament Two" },
    ],
    width,
    `Two-card Home carousel at ${width}px`,
  );
  await assertHomeCarouselCardOpens("later-one", "The first remaining tournament");
  await swipeHomeCarousel("left", "the first remaining tournament");
  await waitForHomeCarouselCard("later-two", 1, width, "The second remaining tournament after a manual swipe");
  await assertHomeCarouselSelectionSurvivesRotation("later-two", 1, 2, width, "two-card list");
  await assertHomeCarouselCardOpens("later-two", "The second remaining tournament");
  await swipeHomeCarousel("right", "the second remaining tournament");
  await waitForHomeCarouselCard("later-one", 0, width, "The first remaining tournament after swiping back");

  assert(
    await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()"),
    `Home could not auto-advance the remaining tournaments at ${width}px.`,
  );
  await waitForHomeCarouselCard("later-two", 1, width, "Auto-advance to the second remaining tournament");
  assert(
    await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()"),
    `Home could not wrap the remaining tournaments at ${width}px.`,
  );
  await waitForHomeCarouselCard("later-one", 0, width, "Auto-advance wrapping to the first remaining tournament");
  console.log(`PASS Home carousel ${width}px — manual swipes, auto-advance, full card visibility, and matching detail taps.`);

  await waitForCondition(
    "window.__daily007HomeCarouselTest.getHomePollCount() === 1 && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() >= 1",
    "Home to install one bounded registration-aware refresh after the initial load",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.getHomePollIntervalMs() === 30000"),
    "Home should refresh tournament and registration data no more often than its existing 30-second interval.",
  );

  const readsBeforeResume = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.setAppVisibility('hidden')");
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', { name: 'Refreshed While Away' })`),
    "The Home tournament fixture should accept updates made while the app is in the background.",
  );
  await delay(80);
  for (let pollTick = 0; pollTick < 2; pollTick += 1) {
    assert(
      await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
      `Home's scheduled poll callback should remain installed during hidden tick ${pollTick + 1}.`,
    );
    await delay(80);
  }
  const stateWhileBackgrounded = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
    cardText: document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText ?? null,
  })`);
  assert(
    stateWhileBackgrounded.tournaments === readsBeforeResume.tournaments &&
      stateWhileBackgrounded.registrations === readsBeforeResume.registrations &&
      stateWhileBackgrounded.cardText?.includes('Later Tournament One') &&
      !stateWhileBackgrounded.cardText?.includes('Refreshed While Away'),
    `Home must not issue either endpoint request or update cards during two hidden 30-second polling ticks: ${JSON.stringify({
      readsBefore: readsBeforeResume,
      stateWhileBackgrounded,
    })}.`,
  );
  await evaluate("window.__daily007HomeCarouselTest.setAppVisibility('visible')");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeResume.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeResume.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('Refreshed While Away')`,
    "Home to issue one fresh tournament-list request and display changes immediately on return to the foreground",
  );
  const readsAfterResume = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterResume.tournaments === readsBeforeResume.tournaments + 1 &&
      readsAfterResume.registrations === readsBeforeResume.registrations + 1,
    "One foreground transition should start only one paired Home refresh.",
  );
  await evaluate("window.__daily007HomeCarouselTest.setAppVisibility('visible')");
  await delay(80);
  const readsAfterDuplicateActive = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterDuplicateActive.tournaments === readsAfterResume.tournaments &&
      readsAfterDuplicateActive.registrations === readsAfterResume.registrations,
    "A repeated active-state event should not trigger a second foreground refresh.",
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
  await evaluate("window.__daily007HomeCarouselTest.setAppVisibility('hidden')");
  await evaluate("window.__daily007HomeCarouselTest.setAppVisibility('visible')");
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
  assert(await evaluate(`(() => {
    const test = window.__daily007HomeCarouselTest;
    test.setRegistrations([
      { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
    ]);
    return test.releaseRegistrationRead([
      { id: "preview-registration-later-one", tournamentId: "later-one", status: "rejected" }
    ]);
  })()`), "The deferred registration response should be released so the failed poll can settle.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsAfterApproval.tournaments + 2} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsAfterApproval.registrations + 2} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to refresh once after the paired failure settles and retain the approved registration",
  );
  const stateAfterFailedPairedRead = await evaluate(`({
    cardText: document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText ?? null,
    tournamentReads: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrationReads: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    stateAfterFailedPairedRead.cardText?.includes("JOINED"),
    `The paired failure and subsequent foreground refresh should preserve the approved registration: ${JSON.stringify(stateAfterFailedPairedRead)}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', {
    name: 'Updated While Registration Refresh Fails'
  })`);
  await evaluate(`(() => {
    window.__daily007HomeCarouselTest.failedRegistrationRefreshCards = [
      ...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')
    ];
    return true;
  })()`);
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "rejected" }
  ])`);
  await evaluate("window.__daily007HomeCarouselTest.failNextRegistrationRead('Temporary registration refresh failure')");
  const readsBeforeFailedRegistrationRefresh = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeFailedRegistrationRefresh.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeFailedRegistrationRefresh.registrations + 1}`,
    "Home to complete a successful tournament read alongside a failed registration read",
  );
  await delay(80);
  const stateAfterFailedRegistrationRead = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="home-upcoming-card-later-one"]');
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    return {
      cardText: card?.innerText ?? null,
      cardCount: cards.length,
      cardNames: cards.map((item) => item.innerText),
      refreshNoticeText: document.querySelector('[data-testid="home-upcoming-refresh-error"]')?.innerText ?? null,
      retryButtonVisible: Boolean(document.querySelector('[data-testid="home-upcoming-retry"]')),
      tournamentReads: window.__daily007HomeCarouselTest.getTournamentReadCount(),
      registrationReads: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
    };
  })()`);
  assert(
    stateAfterFailedRegistrationRead.cardText?.includes("JOINED") &&
      !stateAfterFailedRegistrationRead.cardText?.includes("Updated While Registration Refresh Fails") &&
      stateAfterFailedRegistrationRead.cardCount === 2 &&
      stateAfterFailedRegistrationRead.cardNames[0].includes("Refreshed While Away") &&
      stateAfterFailedRegistrationRead.refreshNoticeText?.includes("cards shown may be out of date") &&
      stateAfterFailedRegistrationRead.refreshNoticeText?.includes("Temporary registration refresh failure") &&
      stateAfterFailedRegistrationRead.retryButtonVisible,
    `A failed registration refresh must show a retryable stale-data notice without hiding existing joined cards: ${JSON.stringify({
      cardText: stateAfterFailedRegistrationRead.cardText,
      cardCount: stateAfterFailedRegistrationRead.cardCount,
      cardNames: stateAfterFailedRegistrationRead.cardNames,
      refreshNoticeText: stateAfterFailedRegistrationRead.refreshNoticeText,
      retryButtonVisible: stateAfterFailedRegistrationRead.retryButtonVisible,
    })}.`,
  );
  assert(
    await evaluate(`(() => {
      const failedState = window.__daily007HomeCarouselTest.failedRegistrationRefreshCards;
      return failedState?.length === 2 &&
        failedState.every((card, index) => card === document.querySelectorAll('[data-testid^="home-upcoming-card-"]')[index]);
    })()`),
    "A failed registration refresh must keep the existing Home card nodes mounted.",
  );
  const readsBeforeRegistrationRecovery = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeRegistrationRecovery.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeRegistrationRecovery.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOIN NOW') && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('Updated While Registration Refresh Fails') && !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "A later scheduled Home refresh to apply the latest tournament and registration state and clear the stale-data notice",
  );
  const readsAfterRejection = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterRejection.tournaments === readsBeforeRegistrationRecovery.tournaments + 1 &&
      readsAfterRejection.registrations === readsBeforeRegistrationRecovery.registrations + 1,
    "The recovered Home poll should perform only one read per endpoint.",
  );
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.unaffectedCardNode === document.querySelector('[data-testid="home-upcoming-card-later-two"]')`),
    "Approval and rejection refreshes should not remount an unaffected tournament card.",
  );

  const readsBeforeDeletionApproval = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "The Home polling callback should be available before registration deletion.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeDeletionApproval.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeDeletionApproval.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to show an approved registration before the Admin deletes it",
  );

  const readsBeforeDeletionRefresh = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.setRegistrations([])");
  assert(await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"), "The scheduled Home refresh should be available after registration deletion.");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeDeletionRefresh.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeDeletionRefresh.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOIN NOW') && !document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "The next scheduled Home refresh to remove JOINED after the Admin deletes the registration",
  );
  assert(
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
      const unaffected = document.querySelector('[data-testid="home-upcoming-card-later-two"]');
      return cards.length === 2 &&
        cards.map((card) => card.getAttribute('data-testid')).join(',') ===
          'home-upcoming-card-later-one,home-upcoming-card-later-two' &&
        unaffected?.innerText.includes('Later Tournament Two') &&
        window.__daily007HomeCarouselTest.unaffectedCardNode === unaffected;
    })()`),
    "Deleting a registration should leave the other tournament card visible and mounted.",
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

  const readsBeforeLeavingHome = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate("window.__daily007HomeCarouselTest.leaveHome()");
  await waitForCondition(
    `!document.querySelector('[data-testid="home-upcoming-carousel"]')`,
    "Home to unmount after navigation away",
  );
  await evaluate(`(() => {
    const test = window.__daily007HomeCarouselTest;
    test.setAppVisibility("hidden");
    test.setAppVisibility("visible");
    return true;
  })()`);
  await delay(120);
  const readsWhileAway = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsWhileAway.tournaments === readsBeforeLeavingHome.tournaments &&
      readsWhileAway.registrations === readsBeforeLeavingHome.registrations,
    `Backgrounding and resuming while Home is unmounted must not start Home API reads: ${JSON.stringify({
      before: readsBeforeLeavingHome,
      whileAway: readsWhileAway,
    })}.`,
  );

  await evaluate("window.__daily007HomeCarouselTest.returnHome()");
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeLeavingHome.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeLeavingHome.registrations + 1} && Boolean(document.querySelector('[data-testid="home-upcoming-carousel"]'))`,
    "Home to perform its normal paired load when opened again",
  );
  const readsAfterReturningHome = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    readsAfterReturningHome.tournaments === readsBeforeLeavingHome.tournaments + 1 &&
      readsAfterReturningHome.registrations === readsBeforeLeavingHome.registrations + 1,
    `Returning to Home should trigger exactly one normal load: ${JSON.stringify({
      before: readsBeforeLeavingHome,
      after: readsAfterReturningHome,
    })}.`,
  );

  const readsBeforeMalformedRegistrationCheck = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "approved" }
  ])`);
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "The Home polling callback should be available before the malformed-registration check.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeMalformedRegistrationCheck.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeMalformedRegistrationCheck.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to show the valid joined state before testing a malformed registration response",
  );
  const readsBeforeMalformedResponse = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  const cardsBeforeMalformedResponse = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    window.__daily007HomeCarouselTest.malformedRegistrationCardNodes = cards;
    return {
      ids: cards.map((card) => card.getAttribute('data-testid')),
      texts: cards.map((card) => card.innerText),
    };
  })()`);
  assert(
    cardsBeforeMalformedResponse.ids.length === 2 &&
      cardsBeforeMalformedResponse.texts[0].includes('JOINED'),
    `The malformed-response test must begin with two cards and a joined tournament: ${JSON.stringify(cardsBeforeMalformedResponse)}.`,
  );
  await evaluate(`window.__daily007HomeCarouselTest.updateTournament('later-one', {
    name: 'Tournament Updated After Valid Registrations'
  })`);
  await evaluate(`window.__daily007HomeCarouselTest.setNextRegistrationResponse({
    unexpected: "registration data is not an array"
  })`);
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "The Home polling callback should be available for the malformed registration response.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeMalformedResponse.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeMalformedResponse.registrations + 1} && Boolean(document.querySelector('[data-testid="home-upcoming-refresh-error"]')) && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOINED')`,
    "Home to reject malformed registration data while showing its prior joined cards",
  );
  const cardsAfterMalformedResponse = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid^="home-upcoming-card-"]')];
    const test = window.__daily007HomeCarouselTest;
    return {
      ids: cards.map((card) => card.getAttribute('data-testid')),
      texts: cards.map((card) => card.innerText),
      sameNodes: test.malformedRegistrationCardNodes?.length === cards.length &&
        test.malformedRegistrationCardNodes.every((card, index) => card === cards[index]),
      errorVisible: Boolean(document.querySelector('[data-testid="home-upcoming-refresh-error"]')),
    };
  })()`);
  assert(
    JSON.stringify(cardsAfterMalformedResponse.ids) === JSON.stringify(cardsBeforeMalformedResponse.ids) &&
      JSON.stringify(cardsAfterMalformedResponse.texts) === JSON.stringify(cardsBeforeMalformedResponse.texts) &&
      cardsAfterMalformedResponse.sameNodes &&
      cardsAfterMalformedResponse.errorVisible,
    `Malformed registration data must preserve the existing Home cards and joined labels: ${JSON.stringify(cardsAfterMalformedResponse)}.`,
  );

  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "rejected" }
  ])`);
  const readsBeforeValidRegistrationRecovery = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home should allow a valid registration refresh after malformed data.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeValidRegistrationRecovery.tournaments + 1} && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeValidRegistrationRecovery.registrations + 1} && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('Tournament Updated After Valid Registrations') && document.querySelector('[data-testid="home-upcoming-card-later-one"]')?.innerText.includes('JOIN NOW') && !document.querySelector('[data-testid="home-upcoming-refresh-error"]')`,
    "a later valid response to update tournament data, apply the current registration state, and clear the error",
  );
  assert(
    await evaluate("!document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]')?.innerText.includes('JOINED')"),
    "The valid rejected-registration response should remove the stale JOINED label.",
  );

  await checkSingleHomeCarouselCard(width);
}

async function checkHomeStartTransitionSelection(width) {
  await waitForCondition(
    "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
    "Home's start-transition fixture to load all three Upcoming matches",
  );
  const initial = await readHomeCarouselState();
  assert(
    JSON.stringify(initial?.cards.map((card) => card.id)) ===
      JSON.stringify(["starting-soon", "later-one", "later-two"]) &&
      initial.activePage === 0 &&
      initial.indicatorCount === 3,
    `The start-transition fixture should begin with three ordered cards and page one selected: ${JSON.stringify(initial)}.`,
  );

  const firstStart = await evaluate("window.__daily007HomeCarouselTest.scheduledStartMs");
  await swipeHomeCarousel("left", "the middle Upcoming tournament before its scheduled start");
  await waitForHomeCarouselCard("later-one", 1, width, "The selected middle Upcoming tournament");
  assert(
    await evaluate(`window.__daily007HomeCarouselTest.getScheduledStartTimerTarget() === ${firstStart}`),
    "Home should be watching the selected middle tournament's scheduled start.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.advancePastScheduledStart()"),
    "The selected middle tournament's fake-clock start could not be advanced.",
  );
  await waitForCondition(
    "window.__daily007HomeCarouselTest.getFakeNow() >= window.__daily007HomeCarouselTest.scheduledStartMs && !document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]') && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 2",
    "Home to remove the selected middle tournament at its scheduled start",
  );
  await waitForHomeCarouselCard("later-two", 1, width, "The next remaining tournament after the middle card starts");
  const afterMiddleStart = await readHomeCarouselState();
  assert(
    JSON.stringify(afterMiddleStart?.cards.map((card) => card.id)) ===
      JSON.stringify(["starting-soon", "later-two"]) &&
      afterMiddleStart.indicatorCount === 2 &&
      afterMiddleStart.activePage === 1,
    `Home should select the following tournament and keep both indicators synchronized after the middle card starts: ${JSON.stringify(afterMiddleStart)}.`,
  );
  await assertHomeCarouselCardOpens("later-two", "The next remaining tournament after the middle card starts");

  const secondStart = firstStart + 60 * 60 * 1000;
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getScheduledStartTimerTarget() === ${secondStart}`,
    "Home to schedule the selected last tournament's start",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.advancePastScheduledStart()"),
    "The selected last tournament's fake-clock start could not be advanced.",
  );
  await waitForCondition(
    "!document.querySelector('[data-testid=\"home-upcoming-card-later-two\"]') && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 1",
    "Home to leave the final Upcoming tournament after the selected last card starts",
  );
  const finalState = await readHomeCarouselState();
  assert(
    finalState?.cards.length === 1 &&
      finalState.cards[0]?.id === "starting-soon" &&
      finalState.indicatorCount === 0 &&
      finalState.activePage === -1 &&
      finalState.cards[0].left >= finalState.viewport.left - 1 &&
      finalState.cards[0].right <= finalState.viewport.right + 1,
    `Home should fully show its final remaining card without stale page indicators: ${JSON.stringify(finalState)}.`,
  );
  await assertHomeCarouselAccessibility(
    [{ id: "starting-soon", name: "Starting at IST" }],
    0,
    "The final remaining tournament after the selected last card starts",
  );
  await assertHomeCarouselCardOpens(
    "starting-soon",
    "The final remaining tournament after the selected last card starts",
  );
  console.log(
    `PASS Home start-time selection at ${width}px — the selected middle card advances to the next remaining tournament, then the selected last card leaves one fully visible, tappable final card.`,
  );
}

async function setKeyboardViewport(height, width = 375) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(120);
}

async function openAdminKeyboardViewport(height = 450, width = 375) {
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(height, width);
  await evaluate("window.scrollTo(0, 0)");
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

async function setTournamentFormValue(selector, value) {
  const updated = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
    input.scrollIntoView({ block: "center", inline: "nearest" });
    const prototype = input instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  assert(updated, `Could not enter text into tournament field ${selector}.`);
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

async function assertAdminFormKeyboardReachability(inputSelector, actionSelector, scrollKey, description) {
  const state = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(inputSelector)});
    const actionRef = ${JSON.stringify(actionSelector)};
    const action = actionRef.startsWith("text:")
      ? [...document.querySelectorAll('[role="button"], button')]
          .find((item) => item.textContent.trim() === actionRef.slice(5))
      : document.querySelector(actionRef);
    if (!input || !action) return { missingInput: !input, missingAction: !action };

    let scroll = input.parentElement;
    while (scroll && scroll !== document.body) {
      const overflowY = getComputedStyle(scroll).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && scroll.contains(action)) break;
      scroll = scroll.parentElement;
    }
    if (!scroll || scroll === document.body) return { missingScrollContainer: true };

    scroll.dataset.keyboardTestScroll = ${JSON.stringify(scrollKey)};
    input.focus({ preventScroll: true });
    const scrollRect = scroll.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const visibleTop = Math.max(0, scrollRect.top);
    const visibleBottom = Math.min(window.innerHeight, scrollRect.bottom);
    const minimumMovement = Math.max(
      visibleTop - inputRect.top,
      visibleTop - actionRect.top,
    );
    const maximumMovement = Math.min(
      visibleBottom - inputRect.bottom,
      visibleBottom - actionRect.bottom,
    );
    if (minimumMovement <= maximumMovement) {
      const movement = Math.max(minimumMovement, Math.min(maximumMovement, 0));
      const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTop = Math.max(0, Math.min(maxScrollTop, scroll.scrollTop - movement));
    }
    const scrolledRect = scroll.getBoundingClientRect();
    const scrolledInputRect = input.getBoundingClientRect();
    const scrolledActionRect = action.getBoundingClientRect();
    const visibleScrollTop = Math.max(0, scrolledRect.top);
    const visibleScrollBottom = Math.min(window.innerHeight, scrolledRect.bottom);
    const fitsVisibleArea = (rect) =>
      rect.top >= visibleScrollTop - 1 && rect.bottom <= visibleScrollBottom + 1;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      inputFocused: document.activeElement === input,
      inputVisible: fitsVisibleArea(scrolledInputRect),
      actionVisible: fitsVisibleArea(scrolledActionRect),
      actionDisabled: action.disabled === true || action.getAttribute("aria-disabled") === "true",
      inputBounds: { top: scrolledInputRect.top, bottom: scrolledInputRect.bottom },
      actionBounds: { top: scrolledActionRect.top, bottom: scrolledActionRect.bottom },
      scrollBounds: { top: scrolledRect.top, bottom: scrolledRect.bottom },
      pageScrollY: window.scrollY,
    };
  })()`);
  assert(state, `${description}: the form could not be inspected.`);
  assert(!state.missingInput, `${description}: the final field is missing.`);
  assert(!state.missingAction, `${description}: the primary action is missing.`);
  assert(!state.missingScrollContainer, `${description}: no scroll area contains the field and primary action.`);
  assert(state.width === 375, `${description}: expected a 375px phone viewport.`);
  assert(
    state.height > 360 && state.height <= 450,
    `${description}: expected a reduced 361–450px keyboard-open viewport (actual=${state.height}px).`,
  );
  assert(state.inputFocused, `${description}: the final field could not receive focus.`);
  assert(
    state.inputVisible,
    `${description}: the focused final field is hidden after scrolling (${JSON.stringify(state)}).`,
  );
  assert(
    state.actionVisible,
    `${description}: the primary action is behind the keyboard after scrolling (${JSON.stringify(state)}).`,
  );
  assert(!state.actionDisabled, `${description}: the primary action is unexpectedly disabled.`);
  return state;
}

async function assertAdminFormLayoutRecovered(scrollKey, keyboardClientHeight, description) {
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(720);
  const recovered = await evaluate(`(() => {
    const scroll = document.querySelector('[data-keyboard-test-scroll="${scrollKey}"]');
    if (!scroll) return null;
    return {
      height: window.innerHeight,
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
    };
  })()`);
  assert(recovered, `${description}: the form's scroll area disappeared after dismissing the keyboard.`);
  assert(recovered.height === 720, `${description}: the full phone viewport did not return.`);
  assert(
    recovered.clientHeight > keyboardClientHeight + 40,
    `${description}: the form did not regain its height after keyboard dismissal ` +
      `(open=${keyboardClientHeight}px, restored=${recovered.clientHeight}px).`,
  );
}

async function setAdminLandscapeKeyboardViewport(height) {
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(height, 800);
  await evaluate("window.scrollTo(0, 0)");
  const viewport = await evaluate(`({
    width: window.innerWidth,
    height: window.innerHeight,
    landscape: matchMedia("(orientation: landscape)").matches,
  })`);
  assert(
    viewport.width === 800 && viewport.height === height && viewport.landscape,
    `Admin landscape keyboard viewport should be 800×${height}, received ` +
      `${viewport.width}×${viewport.height} (landscape=${viewport.landscape}).`,
  );
}

async function setAndCheckLandscapeTournamentField(selector, value, description) {
  await setTournamentFormValue(selector, value);
  await assertReachableControl(selector, description);
  const state = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    return {
      value: input?.value ?? null,
      focused: document.activeElement === input,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  })()`);
  assert(
    state.value === value && state.focused,
    `${description} should retain its entered value and focus while the keyboard is open: ${JSON.stringify(state)}.`,
  );
  assert(
    state.width === 800 && state.height < 360,
    `${description} was not checked in the reduced landscape viewport.`,
  );
  await assertPageHasNoHorizontalOverflow(800, description);
}

async function checkAdminTournamentLandscapeKeyboard() {
  const closedHeight = 360;
  const keyboardHeight = 210;
  const createValues = [
    ['input[placeholder="Tournament name *"]', "Landscape preview tournament"],
    ['input[placeholder="Date (YYYY-MM-DD, IST) *"]', "2030-09-18"],
    ['input[placeholder="Entry coins *"]', "15"],
    ['input[placeholder="Prize pool"]', "120"],
    ['textarea[placeholder="Rules (one per line)"]', "Use the test room only."],
    ['textarea[placeholder="Prize distribution (e.g. 1st: 500 coins)"]', "1st: 120 coins"],
  ];

  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tab-tournaments"]'))`,
    "Admin navigation in landscape",
  );
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments Admin tab");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]'))`,
    "Admin tournament screen in landscape",
  );

  await clickButton("NEW");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-create-form"]'))`,
    "tournament creation form in landscape",
  );
  await setAdminLandscapeKeyboardViewport(keyboardHeight);
  for (const [selector, value] of createValues) {
    await setAndCheckLandscapeTournamentField(
      selector,
      value,
      `Tournament creation field ${selector}`,
    );
  }
  await assertReachableControl(
    '[data-testid="admin-tournament-create-submit"]',
    "Tournament creation action",
  );
  await assertPageHasNoHorizontalOverflow(800, "Tournament creation action");
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(closedHeight, 800);
  const createState = await evaluate(`(() => {
    const form = document.querySelector('[data-testid="admin-tournament-create-form"]');
    return {
      landscape: matchMedia("(orientation: landscape)").matches,
      width: window.innerWidth,
      height: window.innerHeight,
      formVisible: Boolean(form),
      values: ${JSON.stringify(createValues)}.map(([selector]) => document.querySelector(selector)?.value ?? null),
      screenVisible: Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]')),
    };
  })()`);
  assert(
    createState.landscape && createState.width === 800 && createState.height === closedHeight &&
      createState.formVisible && createState.screenVisible &&
      createState.values.every((value, index) => value === createValues[index][1]),
    `Tournament creation state was not preserved after dismissing the landscape keyboard: ${JSON.stringify(createState)}.`,
  );
  await clickButton("CLOSE");
  await waitForCondition(
    `!document.querySelector('[data-testid="admin-tournament-create-form"]')`,
    "tournament creation form to close",
  );

  const roomPanel = '[data-testid="inline-room-management-preview-upcoming"]';
  await clickSelector('[data-testid="manage-room-preview-upcoming"]', "upcoming tournament room setup");
  await waitForCondition(
    `Boolean(document.querySelector(${JSON.stringify(roomPanel)}) &&
      document.querySelector('input[placeholder="Room ID"]') &&
      document.querySelector('input[placeholder="Room Password"]'))`,
    "room setup form in landscape",
  );
  await setAdminLandscapeKeyboardViewport(keyboardHeight);
  const roomValues = [
    ['input[placeholder="Room ID"]', "LANDSCAPE-ROOM-801"],
    ['input[placeholder="Room Password"]', "PASS-801"],
  ];
  for (const [selector, value] of roomValues) {
    await setAndCheckLandscapeTournamentField(selector, value, `Room setup field ${selector}`);
  }
  const roomAction = '[data-testid="save-room-preview-upcoming"]';
  await assertReachableControl(roomAction, "Room setup save action");
  await assertPageHasNoHorizontalOverflow(800, "Room setup save action");
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(closedHeight, 800);
  const roomState = await evaluate(`(() => ({
    landscape: matchMedia("(orientation: landscape)").matches,
    width: window.innerWidth,
    height: window.innerHeight,
    panelVisible: Boolean(document.querySelector(${JSON.stringify(roomPanel)})),
    values: ${JSON.stringify(roomValues)}.map(([selector]) => document.querySelector(selector)?.value ?? null),
    saveEnabled: (() => {
      const action = document.querySelector(${JSON.stringify(roomAction)});
      return Boolean(action && !action.disabled && action.getAttribute("aria-disabled") !== "true");
    })(),
    screenVisible: Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]')),
  }))()`);
  assert(
    roomState.landscape && roomState.width === 800 && roomState.height === closedHeight &&
      roomState.panelVisible && roomState.values.every((value, index) => value === roomValues[index][1]) &&
      roomState.saveEnabled && roomState.screenVisible,
    `Room setup state was not preserved after dismissing the landscape keyboard: ${JSON.stringify(roomState)}.`,
  );
  await clickSelector('[data-testid="manage-room-preview-upcoming"]', "close room setup");
  await waitForCondition(`!document.querySelector(${JSON.stringify(roomPanel)})`, "room setup form to close");

  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "ongoing tournament tab");
  const openResultsSelector = '[data-testid="finish-tournament-preview-ongoing"]';
  await waitForCondition(
    `Boolean(document.querySelector(${JSON.stringify(openResultsSelector)}))`,
    "ongoing tournament in landscape",
  );
  await clickSelector(openResultsSelector, "tournament result-entry form");
  const resultPanel = '[data-testid="inline-results-entry-preview-ongoing"]';
  const selectedPlayer = '[data-testid="result-registration-preview-registration-1"]';
  await waitForCondition(
    `Boolean(document.querySelector(${JSON.stringify(resultPanel)}) && document.querySelector(${JSON.stringify(selectedPlayer)}))`,
    "result-entry form in landscape",
  );
  await clickSelector(selectedPlayer, "approved player for result entry");
  await setAdminLandscapeKeyboardViewport(keyboardHeight);
  const resultValues = [
    ['input[data-testid="result-rank-preview-ongoing"]', "2"],
    ['input[data-testid="result-kills-preview-ongoing"]', "5"],
  ];
  for (const [selector, value] of resultValues) {
    await setAndCheckLandscapeTournamentField(selector, value, `Result-entry field ${selector}`);
  }
  const resultAction = '[data-testid="publish-result-preview-ongoing"]';
  await assertReachableControl(resultAction, "Tournament result publication action");
  await assertPageHasNoHorizontalOverflow(800, "Tournament result publication action");
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(closedHeight, 800);
  const resultState = await evaluate(`(() => {
    const player = document.querySelector(${JSON.stringify(selectedPlayer)});
    const action = document.querySelector(${JSON.stringify(resultAction)});
    return {
      landscape: matchMedia("(orientation: landscape)").matches,
      width: window.innerWidth,
      height: window.innerHeight,
      panelVisible: Boolean(document.querySelector(${JSON.stringify(resultPanel)})),
      values: ${JSON.stringify(resultValues)}.map(([selector]) => document.querySelector(selector)?.value ?? null),
      selectedPlayer: player?.textContent.includes("✓") ?? false,
      publishEnabled: Boolean(action && !action.disabled && action.getAttribute("aria-disabled") !== "true"),
      screenVisible: Boolean(document.querySelector('[data-testid="admin-tournament-tab-ongoing"]')),
    };
  })()`);
  assert(
    resultState.landscape && resultState.width === 800 && resultState.height === closedHeight &&
      resultState.panelVisible && resultState.values.every((value, index) => value === resultValues[index][1]) &&
      resultState.selectedPlayer && resultState.publishEnabled && resultState.screenVisible,
    `Result-entry state was not preserved after dismissing the landscape keyboard: ${JSON.stringify(resultState)}.`,
  );
}

async function checkAdminTournamentKeyboard() {
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tab-tournaments"]'))`,
    "Admin navigation",
  );
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments Admin tab");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]'))`,
    "Admin tournament screen",
  );

  await clickButton("NEW");
  const createInput = 'textarea[placeholder="Prize distribution (e.g. 1st: 500 coins)"]';
  await waitForCondition(`Boolean(document.querySelector(${JSON.stringify(createInput)}))`, "tournament creation form");
  await setInputValue('input[placeholder="Tournament name *"]', "Keyboard preview tournament");
  await setInputValue('input[placeholder="Entry coins *"]', "10");
  await openAdminKeyboardViewport();
  const createState = await assertAdminFormKeyboardReachability(
    createInput,
    "text:CREATE",
    "create-tournament",
    "Tournament creation",
  );
  await assertAdminFormLayoutRecovered("create-tournament", createState.clientHeight, "Tournament creation");
  await clickButton("CLOSE");
  await waitForCondition(`!document.querySelector(${JSON.stringify(createInput)})`, "tournament creation form to close");

  await clickSelector('[data-testid="manage-room-preview-upcoming"]', "upcoming tournament room setup");
  const roomInput = 'input[placeholder="Room Password"]';
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="inline-room-management-preview-upcoming"]') && document.querySelector(${JSON.stringify(roomInput)}))`,
    "room setup form",
  );
  await openAdminKeyboardViewport();
  const roomState = await assertAdminFormKeyboardReachability(
    roomInput,
    '[data-testid="inline-room-management-preview-upcoming"] [role="button"], [data-testid="inline-room-management-preview-upcoming"] button',
    "room-setup",
    "Room setup",
  );
  assert(
    roomState.actionVisible && !roomState.actionDisabled,
    "Room setup: the primary action is not reachable and enabled.",
  );
  await assertAdminFormLayoutRecovered("room-setup", roomState.clientHeight, "Room setup");
  await clickSelector('[data-testid="manage-room-preview-upcoming"]', "close room setup");
  await waitForCondition(
    `!document.querySelector('[data-testid="inline-room-management-preview-upcoming"]')`,
    "room setup form to close",
  );

  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "ongoing tournament tab");
  const openResultsSelector = '[data-testid="finish-tournament-preview-ongoing"]';
  await waitForCondition(`Boolean(document.querySelector(${JSON.stringify(openResultsSelector)}))`, "ongoing tournament");
  await clickSelector(openResultsSelector, "tournament result-entry form");
  const resultInput = 'input[data-testid="result-kills-preview-ongoing"]';
  await waitForCondition(`Boolean(document.querySelector(${JSON.stringify(resultInput)}))`, "result-entry form");
  await clickSelector('[data-testid="result-registration-preview-registration-1"]', "approved player for result entry");
  const resultAction = '[data-testid="publish-result-preview-ongoing"]';
  await waitForCondition(
    `(() => {
      const action = document.querySelector(${JSON.stringify(resultAction)});
      return action && action.getAttribute("aria-disabled") !== "true" && !action.disabled;
    })()`,
    "result publication action to enable",
  );
  await openAdminKeyboardViewport();
  const resultState = await assertAdminFormKeyboardReachability(
    resultInput,
    resultAction,
    "result-entry",
    "Tournament result entry",
  );
  await assertAdminFormLayoutRecovered("result-entry", resultState.clientHeight, "Tournament result entry");
}

async function checkAdminTournamentCreationSaveAtLargeText() {
  await setViewport(320, 1.5);
  await cdp("Emulation.setTimezoneOverride", { timezoneId: "Pacific/Kiritimati" });
  assert(
    await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone === "Pacific/Kiritimati"'),
    "The tournament creation preview did not use the Pacific/Kiritimati browser timezone.",
  );
  assert(
    await evaluate("window.__daily007LargeTextScale === 1.5"),
    "The tournament creation preview did not apply 1.5× Android text scale.",
  );
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tab-tournaments"]'))`,
    "Admin navigation",
  );
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments Admin tab");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]'))`,
    "Admin tournament screen",
  );
  await clickButton("NEW");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-create-form"]'))`,
    "tournament creation form",
  );

  await clickTournamentFormControl("Clash Squad", "Clash Squad mode");
  await clickTournamentFormControl("Duo", "Duo format");
  await clickTournamentFormControl("9", "tournament start hour");
  await clickTournamentFormControl("35", "tournament start minute");
  await clickTournamentFormControl("PM", "tournament start period");
  await clickTournamentFormControl("CS banner", "Clash Squad banner");
  await assertVisibleAdminControlsFit(320, "selected tournament creation form");

  const name = "Clash Night 7";
  const date = "2031-06-17";
  const imageUrl = "https://example.invalid/clash-night.png";
  const rules = "Bring your own device.\nNo scripts or exploits.";
  const prizeDist = "1st: 500 coins\n2nd: 200 coins";
  await setTournamentFormValue('input[placeholder="Tournament name *"]', name);
  await setTournamentFormValue('input[placeholder="Date (YYYY-MM-DD, IST) *"]', date);
  await setTournamentFormValue('input[placeholder="Entry coins *"]', "35");
  await setTournamentFormValue('input[placeholder="Prize pool"]', "700");
  await setTournamentFormValue('input[placeholder="Optional custom banner image URL (HTTPS)"]', imageUrl);
  await setTournamentFormValue('textarea[placeholder="Rules (one per line)"]', rules);
  await setTournamentFormValue('textarea[placeholder="Prize distribution (e.g. 1st: 500 coins)"]', prizeDist);

  await assertText("2 team slots · 4 players", "selected Clash Squad Duo capacity");
  await assertText("Selected: 9:35 PM", "selected tournament start time");
  await assertAdminFormControlBounds(320, "populated tournament creation form");
  await assertPageHasNoHorizontalOverflow(320, "populated tournament creation form");
  await assertVisibleTextFits(
    '[data-testid="admin-tournament-create-form"]',
    320,
    "populated tournament creation form",
  );

  await resetAdminMutationCalls();
  await clickTournamentFormControl("CREATE", "Create tournament action");
  await waitForCondition(
    `document.body.innerText.includes("Tournament created successfully") &&
      !document.querySelector('[data-testid="admin-tournament-create-form"]')`,
    "successful tournament creation and form closure",
  );
  await assertAdminMutation({
    method: "createTournament",
    payload: {
      name,
      mode: "Clash Squad",
      teamType: "Duo",
      date,
      time: "9:35 PM",
      entryCoins: 35,
      prizePool: 700,
      totalSlots: 2,
      rules,
      banner: "cs",
      imageUrl,
      prizeDist,
    },
  }, "Tournament creation");

  const savedSchedule = await evaluate(`JSON.parse(
    window.sessionStorage.getItem("daily007-admin-created-tournament-home-refresh") ?? "null"
  )`);
  assert(
    savedSchedule?.date === date &&
      savedSchedule?.time === "9:35 PM" &&
      savedSchedule?.startsAt === "2031-06-17T16:05:00.000Z",
    `The saved tournament schedule must retain the selected IST date and time, received ${JSON.stringify(savedSchedule)}.`,
  );

  const successState = await evaluate(`({
    successVisible: document.body.innerText.includes("Tournament created successfully"),
    formClosed: !document.querySelector('[data-testid="admin-tournament-create-form"]'),
    width: window.innerWidth,
  })`);
  assert(successState?.successVisible, "The successful tournament creation message was not visible.");
  assert(successState.formClosed, "The tournament creation form remained open after success.");
  assert(successState.width === 320, "The tournament creation flow left the 320px viewport.");
}

async function checkAdminTournamentCreationAppearsOnHomeRefresh() {
  const createdTournamentId = "preview-created-admin-1";
  await checkAdminTournamentCreationSaveAtLargeText();
  await waitForCondition(
    `document.body.innerText.includes("Clash Night 7")`,
    "the Admin tournament list to include the newly created record",
  );

  await waitForCondition(
    `window.sessionStorage.getItem("daily007-admin-created-tournament-home-refresh") !== null`,
    "the created tournament to persist across the Admin-to-Home transition",
  );
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/home-carousel-preview.html?admin-tournament-home-refresh=1`,
  });
  await waitForCondition(
    `window.__daily007HomeCarouselTest?.ready === true &&
      document.querySelectorAll('[data-testid^="home-upcoming-card-"]').length === 3 &&
      window.__daily007HomeCarouselTest.getHomePollCount() === 1`,
    "Home to load its current schedule and install its normal polling refresh",
  );
  const homeBrowserErrorBaseline = new Set(browserErrors);
  const publishedTournamentId = await evaluate(
    "window.__daily007HomeCarouselTest.publishAdminCreatedTournament()",
  );
  assert(
    publishedTournamentId === createdTournamentId,
    `The Home API preview should retrieve the saved Admin tournament, received ${publishedTournamentId}.`,
  );

  const beforeScheduledRefresh = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
    createdCard: Boolean(document.querySelector('[data-testid="home-upcoming-card-${createdTournamentId}"]')),
  })`);
  assert(
    !beforeScheduledRefresh.createdCard,
    "Home should keep its previous schedule until its normal refresh runs.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home's scheduled polling callback should be active after the Admin flow.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${beforeScheduledRefresh.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${beforeScheduledRefresh.registrations + 1} &&
      Boolean(document.querySelector('[data-testid="home-upcoming-card-${createdTournamentId}"]'))`,
    "Home to refresh both endpoints and add the tournament to its schedule",
  );

  const homeState = await readHomeCarouselState();
  assert(homeState, "The refreshed Home carousel should be available.");
  const createdPage = homeState.cards.findIndex((card) => card.id === createdTournamentId);
  assert(createdPage >= 0, `The refreshed Home schedule omitted ${createdTournamentId}.`);
  for (let page = 0; page < createdPage; page += 1) {
    const nextCardId = homeState.cards[page + 1]?.id;
    assert(nextCardId, `Home did not expose carousel page ${page + 2}.`);
    assert(
      await evaluate("window.__daily007HomeCarouselTest.advanceCarousel()"),
      "Home should keep its normal carousel navigation after the refresh.",
    );
    await waitForHomeCarouselCard(
      nextCardId,
      page + 1,
      320,
      `Home carousel navigation to ${nextCardId}`,
    );
  }
  await waitForHomeCarouselCard(
    createdTournamentId,
    createdPage,
    320,
    "The Admin-created tournament after Home's scheduled refresh",
  );
  const createdCardText = await evaluate(
    `document.querySelector('[data-testid="home-upcoming-card-${createdTournamentId}"]')?.innerText ?? ""`,
  );
  assert(
    createdCardText.includes("Clash Night 7") &&
      createdCardText.includes("17 JUN 2031") &&
      createdCardText.includes("9:35 PM IST"),
    `Home should show the created tournament's name and unchanged IST date/time after refresh: ${createdCardText}`,
  );
  const newHomeBrowserErrors = browserErrors.filter((error) => !homeBrowserErrorBaseline.has(error));
  assert(
    newHomeBrowserErrors.length === 0,
    `New browser errors during the Home refresh: ${newHomeBrowserErrors.join(" | ")}`,
  );
}

async function checkDisabledTournamentDisappearsAfterHomeRefresh() {
  await waitForCondition(
    `window.__daily007HomeCarouselTest?.ready === true &&
      document.querySelectorAll('[data-testid^="home-upcoming-card-"]').length === 3 &&
      window.__daily007HomeCarouselTest.getHomePollCount() === 1`,
    "Home to show all three enabled tournaments and install its scheduled poll",
  );

  const beforeClose = await readHomeCarouselState();
  assert(beforeClose, "The initial Home carousel should be available.");
  assert(
    beforeClose.cards.some((card) => card.id === "later-one"),
    "The upcoming tournament should initially be visible on Home.",
  );
  const enabledBefore = await evaluate(
    "window.__daily007HomeCarouselTest.getPublicEnabledTournamentIds()",
  );
  assert(
    Array.isArray(enabledBefore) && enabledBefore.includes("later-one"),
    `The public enabled list should include the upcoming tournament before Admin closes it: ${JSON.stringify(enabledBefore)}.`,
  );

  await evaluate("window.__daily007AdminMutations.reset()");
  const closeResult = await evaluate(
    'window.__daily007HomeCarouselTest.closeTournamentAsAdmin("later-one")',
  );
  assert(
    closeResult?.enabled === false &&
      closeResult.closed === true &&
      closeResult.deleted === false,
    `Admin should close the populated tournament without deleting its history: ${JSON.stringify(closeResult)}.`,
  );
  const mutationCalls = await evaluate("window.__daily007AdminMutations.calls");
  assert(
    mutationCalls.length === 1 &&
      mutationCalls[0].method === "deleteTournament" &&
      mutationCalls[0].id === "later-one",
    `The isolated Admin mock should record one close request for the target tournament: ${JSON.stringify(mutationCalls)}.`,
  );
  const enabledAfter = await evaluate(
    "window.__daily007HomeCarouselTest.getPublicEnabledTournamentIds()",
  );
  assert(
    Array.isArray(enabledAfter) &&
      !enabledAfter.includes("later-one") &&
      enabledAfter.includes("starting-soon") &&
      enabledAfter.includes("later-two"),
    `The enabled public list should omit only the closed tournament: ${JSON.stringify(enabledAfter)}.`,
  );

  const readsBeforeRefresh = await evaluate(`({
    tournaments: window.__daily007HomeCarouselTest.getTournamentReadCount(),
    registrations: window.__daily007HomeCarouselTest.getMyRegistrationReadCount(),
  })`);
  assert(
    await evaluate("Boolean(document.querySelector('[data-testid=\"home-upcoming-card-later-one\"]'))"),
    "Home should retain its current card until the scheduled refresh runs.",
  );
  assert(
    await evaluate("window.__daily007HomeCarouselTest.fireHomePoll()"),
    "Home's normal scheduled poll should still be active.",
  );
  await waitForCondition(
    `window.__daily007HomeCarouselTest.getTournamentReadCount() === ${readsBeforeRefresh.tournaments + 1} &&
      window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === ${readsBeforeRefresh.registrations + 1} &&
      !document.querySelector('[data-testid="home-upcoming-card-later-one"]') &&
      Boolean(document.querySelector('[data-testid="home-upcoming-card-starting-soon"]')) &&
      Boolean(document.querySelector('[data-testid="home-upcoming-card-later-two"]'))`,
    "Home's scheduled refresh to remove only the disabled tournament",
  );

  const afterRefresh = await readHomeCarouselState();
  assert(afterRefresh, "The refreshed Home carousel should remain available.");
  const remainingCardIds = afterRefresh.cards.map((card) => card.id);
  assert(
    JSON.stringify(remainingCardIds) === JSON.stringify(["starting-soon", "later-two"]),
    `The scheduled refresh should keep the other carousel cards intact: ${JSON.stringify(afterRefresh.cards)}.`,
  );
}

async function checkAdminTournamentEditSaveAtLargeText() {
  await setViewport(320, 1.5);
  await cdp("Emulation.setTimezoneOverride", { timezoneId: "Pacific/Kiritimati" });
  assert(
    await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone === "Pacific/Kiritimati"'),
    "The tournament edit preview did not use the Pacific/Kiritimati browser timezone.",
  );
  assert(
    await evaluate("window.__daily007LargeTextScale === 1.5"),
    "The tournament edit preview did not apply 1.5× Android text scale.",
  );
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tab-tournaments"]'))`,
    "Admin navigation",
  );
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments Admin tab");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-tab-upcoming"]'))`,
    "Admin tournament screen",
  );
  const editButton = '[data-testid="edit-tournament-preview-upcoming"]';
  await waitForCondition(`Boolean(document.querySelector(${JSON.stringify(editButton)}))`, "existing upcoming tournament");
  await clickSelector(editButton, "Edit existing tournament");
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="admin-tournament-create-form"]'))`,
    "tournament edit form",
  );
  await assertText("EDIT TOURNAMENT", "edit tournament form heading");

  await clickTournamentFormControl("Clash Squad", "edited Clash Squad mode");
  await clickTournamentFormControl("Duo", "edited Duo format");
  await clickTournamentFormControl("9", "edited tournament start hour");
  await clickTournamentFormControl("35", "edited tournament start minute");
  await clickTournamentFormControl("PM", "edited tournament start period");
  await clickTournamentFormControl("CS banner", "edited Clash Squad banner");

  const name = "Clash Night 8";
  await setTournamentFormValue('input[placeholder="Tournament name *"]', name);
  await assertVisibleAdminControlsFit(320, "selected tournament edit form");
  const date = "2031-06-17";
  const imageUrl = "https://example.invalid/clash-night-8.png";
  const rules = "Bring your own device.\nNo scripts or exploits.";
  const prizeDist = "1st: 700 coins\n2nd: 300 coins";
  await setTournamentFormValue('input[placeholder="Date (YYYY-MM-DD, IST) *"]', date);
  await setTournamentFormValue('input[placeholder="Entry coins *"]', "35");
  await setTournamentFormValue('input[placeholder="Prize pool"]', "1000");
  await setTournamentFormValue('input[placeholder="Optional custom banner image URL (HTTPS)"]', imageUrl);
  await setTournamentFormValue('textarea[placeholder="Rules (one per line)"]', rules);
  await setTournamentFormValue('textarea[placeholder="Prize distribution (e.g. 1st: 500 coins)"]', prizeDist);

  await assertText("2 team slots · 4 players", "selected Clash Squad Duo capacity");
  await assertText("Selected: 9:35 PM", "selected edited tournament start time");
  await assertAdminFormControlBounds(320, "populated tournament edit form");
  await assertPageHasNoHorizontalOverflow(320, "populated tournament edit form");
  await assertVisibleTextFits(
    '[data-testid="admin-tournament-create-form"]',
    320,
    "populated tournament edit form",
  );

  const bannerUrlInput = 'input[placeholder="Optional custom banner image URL (HTTPS)"]';
  const validationMessage = "Custom banner image must be a valid HTTPS URL.";
  const unsafeBannerUrls = [
    ["non-HTTPS", "http://example.invalid/clash-night-8.png"],
    ["embedded credentials", "https://admin:password@example.invalid/clash-night-8.png"],
  ];
  for (const [description, unsafeUrl] of unsafeBannerUrls) {
    await setTournamentFormValue(bannerUrlInput, unsafeUrl);
    await resetAdminMutationCalls();
    await clickTournamentFormControl(
      "SAVE CHANGES",
      `Reject tournament edit with ${description} banner URL`,
    );
    await waitForCondition(
      `document.body.innerText.includes(${JSON.stringify(validationMessage)}) &&
        Boolean(document.querySelector('[data-testid="admin-tournament-create-form"]'))`,
      `${description} banner URL validation while keeping the edit form open`,
    );
    const rejectedState = await evaluate(`(() => ({
      errorVisible: document.body.innerText.includes(${JSON.stringify(validationMessage)}),
      formOpen: Boolean(document.querySelector('[data-testid="admin-tournament-create-form"]')),
      enteredUrl: document.querySelector(${JSON.stringify(bannerUrlInput)})?.value ?? null,
      mutationCalls: window.__daily007AdminMutations?.calls ?? null,
    }))()`);
    assert(
      rejectedState?.errorVisible &&
        rejectedState.formOpen &&
        rejectedState.enteredUrl === unsafeUrl &&
        Array.isArray(rejectedState.mutationCalls) &&
        rejectedState.mutationCalls.length === 0,
      `The ${description} banner URL should show validation, preserve the edit form, and make no update API call: ${JSON.stringify(rejectedState)}.`,
    );
  }

  await setTournamentFormValue(bannerUrlInput, imageUrl);
  await resetAdminMutationCalls();
  await clickTournamentFormControl("SAVE CHANGES", "Save tournament changes action");
  await waitForCondition(
    `document.body.innerText.includes("Tournament updated successfully") &&
      !document.querySelector('[data-testid="admin-tournament-create-form"]')`,
    "successful tournament update and form closure",
  );
  await assertAdminMutation({
    method: "updateTournament",
    id: "preview-upcoming",
    payload: {
      name,
      mode: "Clash Squad",
      teamType: "Duo",
      date,
      time: "9:35 PM",
      entryCoins: 35,
      prizePool: 1000,
      totalSlots: 2,
      rules,
      banner: "cs",
      imageUrl,
      prizeDist,
    },
  }, "Tournament edit");

  const successState = await evaluate(`({
    successVisible: document.body.innerText.includes("Tournament updated successfully"),
    formClosed: !document.querySelector('[data-testid="admin-tournament-create-form"]'),
    width: window.innerWidth,
  })`);
  assert(successState?.successVisible, "The successful tournament update message was not visible.");
  assert(successState.formClosed, "The tournament edit form remained open after success.");
  assert(successState.width === 320, "The tournament edit flow left the 320px viewport.");
}

let vitePort;

async function checkIstDateSurfaces(port) {
  const surfaces = ["Home", "MyMatches", "TDetail"];
  const phases = ["before", "after"];
  const currentIstYear = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(new Date()));
  const timestampAtIstNewYear = (utcYear) => `${utcYear}-12-31T18:45:00.000Z`;
  const scenarios = [
    {
      id: "new-year",
      timezoneIds: ["America/Los_Angeles", "Asia/Kolkata"],
      date: "01 JAN 2030",
      homeDate: "01 JAN",
      time: "12:15 AM IST",
    },
    {
      id: "timestamp-current-ist-year",
      surfaces: ["MyMatches", "TDetail"],
      timezoneIds: ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"],
      date: "01 JAN",
      homeDate: "01 JAN",
      time: "12:15 AM IST",
      dateValue: timestampAtIstNewYear(currentIstYear - 1),
    },
    {
      id: "timestamp-previous-ist-year",
      surfaces: ["MyMatches", "TDetail"],
      timezoneIds: ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"],
      date: `01 JAN ${currentIstYear - 1}`,
      homeDate: "01 JAN",
      time: "12:15 AM IST",
      dateValue: timestampAtIstNewYear(currentIstYear - 2),
    },
    {
      id: "timestamp-next-ist-year",
      surfaces: ["MyMatches", "TDetail"],
      timezoneIds: ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"],
      date: `01 JAN ${currentIstYear + 1}`,
      homeDate: "01 JAN",
      time: "12:15 AM IST",
      dateValue: timestampAtIstNewYear(currentIstYear),
    },
    {
      id: "positive-offset",
      timezoneIds: ["Pacific/Kiritimati"],
      date: "31 DEC 2029",
      homeDate: "31 DEC",
      time: "10:30 PM IST",
    },
    {
      id: "date-only",
      timezoneIds: ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"],
      date: `01 JAN ${currentIstYear + 1}`,
      homeDate: "01 JAN",
      time: "12:15 AM IST",
      dateValue: `${currentIstYear + 1}-01-01`,
    },
  ];

  for (const scenario of scenarios) {
    const dateOnlyScenario = scenario.id === "date-only";
    const noStartInstantScenario = dateOnlyScenario || scenario.id.startsWith("timestamp-");
    const scenarioSurfaces = scenario.surfaces ?? surfaces;
    const timezoneStates = new Map();
    for (const timezoneId of scenario.timezoneIds) {
      await cdp("Emulation.setTimezoneOverride", { timezoneId });
      const phaseStates = new Map();
      timezoneStates.set(timezoneId, phaseStates);
      const timezoneCondition = timezoneId === "Asia/Kolkata"
        ? `["Asia/Kolkata", "Asia/Calcutta"].includes(Intl.DateTimeFormat().resolvedOptions().timeZone)`
        : `Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(timezoneId)}`;

      for (const phase of phases) {
        const states = new Map();
        phaseStates.set(phase, states);

        for (const screen of scenarioSurfaces) {
          const params = new URLSearchParams({
            "ist-date-surfaces": "1",
            "ist-date-phase": phase,
            "ist-date-scenario": scenario.id,
            screen,
          });
          if (scenario.dateValue) params.set("ist-date-value", scenario.dateValue);
          await cdp("Page.navigate", {
            url: `http://127.0.0.1:${port}/home-carousel-preview.html?${params}`,
          });
          if (screen === "MyMatches") {
            await waitForCondition(
              `${timezoneCondition} && window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("MY MATCHES")`,
              `My Matches to mount in ${timezoneId}`,
            );
            if (phase === "after" && !noStartInstantScenario) {
              await evaluate(`document.querySelector('[data-testid="my-matches-tab-ongoing"]')?.click()`);
            }
          }
          const readyCondition = screen === "Home"
            ? phase === "before" || dateOnlyScenario
              ? `window.__daily007HomeCarouselTest?.ready === true && document.querySelector('[data-testid="home-upcoming-card-starting-soon"]')?.innerText.includes(${JSON.stringify(scenario.homeDate)})`
              : `window.__daily007HomeCarouselTest?.ready === true && !document.querySelector('[data-testid="home-upcoming-card-starting-soon"]') && document.body.innerText.includes("Later Tournament One")`
            : screen === "MyMatches"
              ? phase === "before" || noStartInstantScenario
                ? `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: ${scenario.date}") && document.body.innerText.includes("CONFIRMED")`
                : `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: ${scenario.date}") && document.body.innerText.includes("ONGOING") && !document.body.innerText.includes("CONFIRMED")`
              : phase === "before"
                ? `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: ${scenario.date}") && document.body.innerText.includes("UPCOMING")`
                : noStartInstantScenario
                  ? `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: ${scenario.date}") && document.body.innerText.includes("UPCOMING")`
                  : `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: ${scenario.date}") && document.body.innerText.includes("ONGOING") && !document.body.innerText.includes("UPCOMING")`;
          await waitForCondition(
            `${timezoneCondition} && (${readyCondition})`,
            `${screen} to render the ${phase}-start IST state in ${timezoneId}`,
          );

          const state = await evaluate(`(() => {
            const bodyText = document.body.innerText;
            const homeCard = document.querySelector('[data-testid="home-upcoming-card-starting-soon"]');
            const text = ${JSON.stringify(screen)} === "Home" ? (homeCard?.innerText ?? "") : bodyText;
            const scheduledDateLabel = ${JSON.stringify(`SCHEDULED START: ${scenario.date}`)};
            const lifecycle = ${JSON.stringify(screen)} === "Home"
              ? (homeCard
                ? (text.includes("UPCOMING") ? "upcoming" : text.includes("ONGOING") ? "ongoing" : "unknown")
                : "ongoing")
              : ${JSON.stringify(screen)} === "MyMatches"
                ? (text.includes(scheduledDateLabel)
                  ? (text.includes("CONFIRMED") ? "upcoming" : text.includes("ONGOING") ? "ongoing" : "unknown")
                  : "unknown")
                : (text.includes(scheduledDateLabel)
                  ? (text.includes("UPCOMING") ? "upcoming" : text.includes("ONGOING") ? "ongoing" : "unknown")
                  : "unknown");
            return {
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              text,
              laterCardVisible: bodyText.includes("Later Tournament One"),
              lifecycle,
            };
          })()`);

          assert(
            state?.timezone === timezoneId ||
              (timezoneId === "Asia/Kolkata" && ["Asia/Kolkata", "Asia/Calcutta"].includes(state?.timezone)),
            `${screen} must be checked in the requested browser timezone.`,
          );
          const expectedLifecycle = phase === "before" || noStartInstantScenario ? "upcoming" : "ongoing";
          assert(
            state?.lifecycle === expectedLifecycle,
            `${screen} must classify the tournament as ${expectedLifecycle} ${noStartInstantScenario ? "because no start instant is available" : phase === "before" ? "before" : "after the same start instant"} in ${timezoneId}.`,
          );
          if (noStartInstantScenario) {
            const hasStartsAt = screen === "Home"
              ? await evaluate("window.__daily007HomeCarouselTest.getTournamentStartFieldPresence().some(Boolean)")
              : await evaluate("window.__daily007IstDateSurfacePreview?.hasStartsAt");
            assert(hasStartsAt === false, `${screen} no-start fixture unexpectedly included startsAt.`);
          }
          const dateIsCorrect = screen === "Home"
            ? phase === "after"
              && !dateOnlyScenario
              ? state.text === "" && state.laterCardVisible
              : state.text.includes(`${scenario.homeDate} • ${scenario.time}`)
            : state.text.includes(scenario.date) && state.text.includes(scenario.time);
          assert(
            dateIsCorrect,
            `${screen} must preserve the ${scenario.date} IST calendar date and ${scenario.time} start in ${timezoneId}.`,
          );
          states.set(screen, state.lifecycle);
        }
      }
    }

    if (scenario.timezoneIds.length > 1) {
      const referenceTimezone = scenario.timezoneIds[0];
      for (const phase of phases) {
        for (const screen of scenarioSurfaces) {
          for (const timezoneId of scenario.timezoneIds.slice(1)) {
            assert(
              timezoneStates.get(referenceTimezone)?.get(phase)?.get(screen) ===
                timezoneStates.get(timezoneId)?.get(phase)?.get(screen),
              `${screen} lifecycle classification must not change with the browser timezone ${phase} its start.`,
            );
          }
        }
      }
    }
  }
}

async function checkAdminFullAdminRoleRefreshRecovery() {
  const userId = "preview-full-admin-recovery";
  const userEmail = "full-admin-recovery@example.invalid";
  const userName = "Full Admin Recovery Preview";
  const expectedStatus = "User list is current.";
  const initialAccessibleRoleName = `${userName}, Full Admin`;
  const recoveredAccessibleRoleName = `${userName}, Tournament Admin`;

  await clickSelector('[data-testid="admin-tab-users"]', "Users tab");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(userEmail)})`,
    "the isolated Full Admin recovery account to load",
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["FULL ADMIN"], excludes: ["TOURNAMENT ADMIN", "PLAYER"] },
    "the Full Admin account before the safeguard rejection",
  );

  const initialRoleName = await evaluate(`(() => {
    const expected = ${JSON.stringify(initialAccessibleRoleName)};
    return [...document.querySelectorAll("[aria-label]")]
      .find((node) => node.getAttribute("aria-label") === expected)
      ?.getAttribute("aria-label") ?? null;
  })()`);
  assert(
    initialRoleName === initialAccessibleRoleName,
    `The initial Full Admin row should expose its name and role together: ${String(initialRoleName)}.`,
  );

  await resetAdminMutationCalls();
  await failNextAdminMutation(
    "adminSetUserRole",
    "At least one full administrator must remain.",
  );
  const configuredReadFailure = await evaluate(`(() => {
    const tracker = window.__daily007AdminMutations;
    if (!tracker?.failNextUserRead) return false;
    tracker.failNextUserRead("Preview user-list refresh failure");
    return true;
  })()`);
  assert(configuredReadFailure, "Could not configure the isolated one-time user-list refresh failure.");

  await clickSelector(`[data-testid="change-user-role-${userId}"]`, "Full Admin role action");
  await clickSelector(
    '[data-testid="confirm-tournament-admin-change"]',
    "confirm the Full Admin role action",
  );
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify("Refresh failed: Preview user-list refresh failure.")})`,
    "the safeguard rejection and failed immediate user-list refresh",
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["FULL ADMIN"], excludes: ["TOURNAMENT ADMIN", "PLAYER"] },
    "the Full Admin account after the failed immediate refresh",
  );
  const rejectedMutationCalls = await evaluate("window.__daily007AdminMutations?.calls ?? null");
  assert(
    Array.isArray(rejectedMutationCalls) && rejectedMutationCalls.length === 0,
    `The rejected role change must not be recorded as a successful mutation: ${JSON.stringify(rejectedMutationCalls)}.`,
  );
  const changedRole = await evaluate(`(() => {
    const controls = window.__daily007AdminMutations;
    if (typeof controls?.changeRecoveryPreviewRole !== "function") return false;
    controls.changeRecoveryPreviewRole("tournament_admin");
    return true;
  })()`);
  assert(
    changedRole,
    "Could not simulate an external role change before the successful user-list recovery.",
  );

  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await tapSelector(
    '[data-testid="player-refresh-control-test-action"]',
    "successful user-list refresh",
  );
  await waitForCondition(
    `(() => {
      const toast = document.querySelector('[data-testid="admin-toast"]');
      return toast?.getAttribute("aria-label") === ${JSON.stringify(expectedStatus)} &&
        toast?.getAttribute("aria-live") === "polite";
    })()`,
    "the polite status confirming the recovered user list without claiming the old role",
  );
  const toastState = await evaluate(`(() => {
    const toast = document.querySelector('[data-testid="admin-toast"]');
    return toast ? {
      label: toast.getAttribute("aria-label"),
      live: toast.getAttribute("aria-live"),
      text: toast.textContent.trim(),
    } : null;
  })()`);
  assert(
    toastState?.label === expectedStatus &&
      toastState.live === "polite" &&
      toastState.text.includes(expectedStatus) &&
      !toastState.text.includes("Full Admin"),
    `The recovered status must be visible and politely announced without claiming the account remains Full Admin: ${JSON.stringify(toastState)}.`,
  );
  await assertAdminRecordState(
    userEmail,
    { includes: ["TOURNAMENT ADMIN"], excludes: ["FULL ADMIN", "PLAYER"] },
    "the externally changed Tournament Admin account after the successful refresh",
  );
  const recoveredRoleName = await evaluate(`(() => {
    const expected = ${JSON.stringify(recoveredAccessibleRoleName)};
    return [...document.querySelectorAll("[aria-label]")]
      .find((node) => node.getAttribute("aria-label") === expected)
      ?.getAttribute("aria-label") ?? null;
  })()`);
  assert(
    recoveredRoleName === recoveredAccessibleRoleName,
    `The refreshed row should announce the server-confirmed Tournament Admin role: ${String(recoveredRoleName)}.`,
  );
}

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-admin-narrow-"));
  const previewPath = adminFullAdminRecoveryOnly
    ? "admin-narrow-preview.html?admin-full-admin-recovery-only=1&manual-refresh-only=1"
    : istDateSurfacesOnly
    ? "home-carousel-preview.html?ist-date-surfaces=1"
    : adminResultEntryRetryOnly
      ? "tournament-resume-preview.html?admin-result-entry-retry-only=1"
    : adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly
    ? "tournament-resume-preview.html?admin-initial-load-failure-only=1"
    : refreshCoalescingOnly
      ? "tournament-resume-preview.html?manual-refresh-only=1"
    : refreshReturnOnly
      ? "tournament-resume-preview.html?manual-refresh-only=1&resume-while-refresh-only=1"
    : manualRefreshOnly || manualRefreshLargeTextOnly
      ? "tournament-resume-preview.html?manual-refresh-only=1"
    : tournamentDetailRegistrationFailureOnly
      ? "tournament-resume-preview.html?detail-registration-failure-only=1"
    : registrationInitialLoadFailureOnly
      ? "tournament-resume-preview.html?registration-initial-load-failure-only=1"
    : initialLoadFailureOnly
    ? "tournament-resume-preview.html?initial-load-failure-only=1"
    : resumeOnly
      ? "tournament-resume-preview.html"
    : sameTimeStartOnly
      ? "tournament-resume-preview.html?scheduled-start-only=1&same-time-start-only=1&boundary=month-end"
    : scheduledStartOnly
      ? "tournament-resume-preview.html?scheduled-start-only=1&boundary=month-end"
      : adminTournamentHomeRefreshOnly
        ? "admin-narrow-preview.html"
      : adminTournamentEmptyFilterOnly
        ? "admin-narrow-preview.html?admin-tournament-empty-filter=1"
    : homeStartTransitionOnly
      ? "home-carousel-preview.html?home-start-selection=1"
      : homeRefreshOverlapOnly
        ? "home-carousel-preview.html?manual-refresh-only=1"
      : homeQueuedAwayOnly
        ? "home-carousel-preview.html?manual-refresh-only=1"
      : homeInitialRetryOnly
        ? "home-carousel-preview.html?home-initial-retry=tournament"
      : singleHomeCardOnly
        ? "home-carousel-preview.html?single-card=1"
      : homeCarouselOnly || homeRetryOnly || homeInitialRetryOnly || homeRefreshOverlapOnly || homeQueuedAwayOnly || homeDisabledTournamentRefreshOnly
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
  if (scheduledStartOnly || sameTimeStartOnly || istDateSurfacesOnly) {
    await cdp("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
    await cdp("Page.reload", { ignoreCache: true });
  }
  if (
    resumeOnly ||
    initialLoadFailureOnly ||
    registrationInitialLoadFailureOnly ||
    tournamentDetailRegistrationFailureOnly ||
    adminInitialLoadFailureOnly ||
    adminLargeTextInitialLoadFailureOnly ||
    adminRetryConcurrencyOnly ||
    adminResultEntryRetryOnly ||
    refreshReturnOnly ||
    refreshCoalescingOnly ||
    manualRefreshOnly ||
    manualRefreshLargeTextOnly ||
    scheduledStartOnly ||
    sameTimeStartOnly ||
    istDateSurfacesOnly ||
    homeCarouselOnly ||
    singleHomeCardOnly ||
    homeStartTransitionOnly ||
    homeRetryOnly ||
    homeInitialRetryOnly ||
    homeRefreshOverlapOnly ||
    homeQueuedAwayOnly ||
    homeDisabledTournamentRefreshOnly ||
    keyboardFormsOnly ||
    adminKeyboardFormsOnly ||
    adminNotificationKeyboardOnly ||
    adminNotificationsAccessibilityOnly ||
    adminSearchKeyboardOnly ||
    adminSearchAccessibilityOnly ||
    adminLandscapeKeyboardOnly ||
    adminLandscapeLargeTextOnly ||
    adminTournamentCreateSaveOnly ||
    adminTournamentEmptyFilterOnly ||
    adminTournamentHomeRefreshOnly ||
    adminTournamentEditSaveOnly ||
    adminActionsOnly ||
    adminFullAdminRecoveryOnly ||
    adminLandscapeOnly
  ) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: adminLandscapeOnly || adminLandscapeKeyboardOnly || adminLandscapeLargeTextOnly
        ? 800
        : homeCarouselOnly || singleHomeCardOnly || homeStartTransitionOnly || homeRetryOnly || homeInitialRetryOnly || homeRefreshOverlapOnly || homeQueuedAwayOnly || homeDisabledTournamentRefreshOnly || scheduledStartOnly || sameTimeStartOnly || istDateSurfacesOnly || adminActionsOnly || adminFullAdminRecoveryOnly || adminTournamentHomeRefreshOnly || adminTournamentEmptyFilterOnly || refreshReturnOnly || refreshCoalescingOnly || adminResultEntryRetryOnly
           || initialLoadFailureOnly || registrationInitialLoadFailureOnly || tournamentDetailRegistrationFailureOnly || adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly || manualRefreshOnly || manualRefreshLargeTextOnly
          ? 390
          : keyboardFormsOnly || adminKeyboardFormsOnly || adminNotificationKeyboardOnly || adminNotificationsAccessibilityOnly || adminSearchKeyboardOnly || adminSearchAccessibilityOnly ? 375 : 800,
      height: adminLandscapeOnly || adminLandscapeKeyboardOnly || adminLandscapeLargeTextOnly
        ? 360
        : homeCarouselOnly || singleHomeCardOnly || homeStartTransitionOnly || homeRetryOnly || homeInitialRetryOnly || homeRefreshOverlapOnly || homeQueuedAwayOnly || homeDisabledTournamentRefreshOnly || scheduledStartOnly || sameTimeStartOnly || istDateSurfacesOnly || adminActionsOnly || adminFullAdminRecoveryOnly || adminTournamentHomeRefreshOnly || adminTournamentEmptyFilterOnly || refreshReturnOnly || refreshCoalescingOnly || adminResultEntryRetryOnly
           || initialLoadFailureOnly || registrationInitialLoadFailureOnly || tournamentDetailRegistrationFailureOnly || adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly || manualRefreshOnly || manualRefreshLargeTextOnly
          ? 844
          : keyboardFormsOnly || adminKeyboardFormsOnly || adminNotificationKeyboardOnly || adminNotificationsAccessibilityOnly || adminSearchKeyboardOnly || adminSearchAccessibilityOnly ? 720 : 1000,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForPage(
      adminLandscapeOnly
        ? "Admin landscape screens"
        : adminLandscapeLargeTextOnly
          ? "Admin landscape large-text screens"
        : adminLandscapeKeyboardOnly
          ? "Admin tournament landscape keyboard screens"
        : istDateSurfacesOnly
          ? "Home, My Matches, and tournament details IST date surfaces"
         : homeRetryOnly
         ? "Home retry recovery"
         : homeInitialRetryOnly
         ? "Home initial-load retry recovery"
         : homeRefreshOverlapOnly
         ? "Home refresh overlap recovery"
         : homeQueuedAwayOnly
         ? "Home queued refresh while away"
          : homeStartTransitionOnly
            ? "Home scheduled-start carousel selection"
         : homeCarouselOnly
         ? "Home carousel"
        : singleHomeCardOnly
          ? "Single-card Home carousel activation"
        : adminResultEntryRetryOnly
          ? "Admin Result Entry approved-player retry"
        : adminTournamentHomeRefreshOnly
          ? "Admin tournament creation and Home scheduled refresh"
        : adminTournamentEmptyFilterOnly
          ? "Admin tournament empty filters"
        : initialLoadFailureOnly
          ? "Player first-load failure"
        : registrationInitialLoadFailureOnly
          ? "Player registration lookup failure"
        : tournamentDetailRegistrationFailureOnly
          ? "Tournament-detail registration lookup failure"
        : adminInitialLoadFailureOnly
          ? "Admin first-load failure"
        : adminLargeTextInitialLoadFailureOnly
          ? "Admin first-load failure at 1.5× text"
        : adminRetryConcurrencyOnly
          ? "Admin Retry concurrency"
        : refreshReturnOnly
          ? "Player refresh after returning to the tournament list"
        : refreshCoalescingOnly
          ? "Player app-resume/manual refresh coalescing"
         : manualRefreshLargeTextOnly
           ? "Player pull-to-refresh at large Android text"
         : manualRefreshOnly
          ? "Player pull-to-refresh"
        : sameTimeStartOnly
          ? "simultaneous-start Player and Admin tournament screens"
        : scheduledStartOnly
          ? "scheduled-start Player and Admin tournament screens"
        : keyboardFormsOnly
          ? "Wallet and Edit Profile"
        : adminKeyboardFormsOnly
          ? "Admin tournament keyboard forms"
        : adminNotificationKeyboardOnly
          ? "Admin notification keyboard preview"
        : adminNotificationsAccessibilityOnly
          ? "Admin notification recipient accessibility preview"
        : adminSearchKeyboardOnly
          ? "Admin Wallet and Users search fields"
        : adminSearchAccessibilityOnly
          ? "Admin Wallet and Users search announcements"
        : adminTournamentEditSaveOnly
          ? "Admin tournament editing at 320px with 1.5× text"
        : adminTournamentCreateSaveOnly
          ? "Admin tournament creation at 320px with 1.5× text"
        : adminActionsOnly
          ? "Admin selected-record actions"
        : adminFullAdminRecoveryOnly
          ? "Admin Full Admin role-refresh recovery"
          : "player and Admin tournament screens",
    );
    if (adminLandscapeOnly) {
      const viewport = await evaluate(`({
        width: window.innerWidth,
        height: window.innerHeight,
        landscape: matchMedia("(orientation: landscape)").matches,
      })`);
      assert(
        viewport.width === 800 && viewport.height === 360 && viewport.landscape,
        `The Admin landscape preview expected 800×360 CSS pixels, received ` +
          `${viewport.width}×${viewport.height} (landscape=${viewport.landscape}).`,
      );
      await checkAdminTabs(800, { requireReachability: true });
      await checkPopulatedAdminLists(800, { requireReachability: true });
      await checkTournamentStates(800, { landscape: true });
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin landscape checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS 800×360 Android landscape — all 11 Admin tabs, populated list actions, and tournament create, room, results, and completed-result controls remain reachable without horizontal clipping.",
      );
    } else if (adminLandscapeLargeTextOnly) {
      await setViewport(800, 1.5);
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 800,
        height: 360,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await delay(150);
      const viewport = await evaluate(`({
        width: window.innerWidth,
        height: window.innerHeight,
        landscape: matchMedia("(orientation: landscape)").matches,
        fontScale: window.__daily007LargeTextScale,
      })`);
      assert(
        viewport.width === 800 && viewport.height === 360 && viewport.landscape &&
          viewport.fontScale === 1.5,
        `The large-text Admin landscape preview expected 800×360 at 1.5×, received ` +
          `${viewport.width}×${viewport.height}, landscape=${viewport.landscape}, scale=${viewport.fontScale}.`,
      );
      await checkAdminTabs(800, { requireReachability: true });
      await checkPopulatedAdminLists(800, { requireReachability: true });
      await checkTournamentStates(800, { largeText: true, landscape: true });
      assert(
        browserErrors.length === 0,
        `Browser errors during large-text Admin landscape checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS 800×360 Android landscape at 1.5× text — all 11 Admin tabs, populated row actions, tournament creation, room setup, result entry, and completed-result details remain reachable and readable without horizontal overflow.",
      );
    } else if (adminLandscapeKeyboardOnly) {
      await checkAdminTournamentLandscapeKeyboard();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin landscape keyboard checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Tournament creation, room setup, and result entry remain usable at 800×210 with a simulated landscape Android keyboard; values and the Tournaments screen persist after returning to 800×360.",
      );
    } else if (adminRetryConcurrencyOnly) {
      await checkAdminRetryConcurrency();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin Retry concurrency checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Repeated taps while an Admin Retry is pending do not duplicate requests; failure re-enables the control for recovery.");
    } else if (adminResultEntryRetryOnly) {
      await checkAdminResultEntryRetry();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin Result Entry retry checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Result Entry stays open through failed and successful approved-player retries; requests are scoped and duplicate taps do not duplicate work.");
    } else if (tournamentDetailRegistrationFailureOnly) {
      await checkTournamentDetailRegistrationFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during tournament-detail registration-failure checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Tournament details remain visible after a failed registration lookup; joining stays unavailable until retry confirms the player is already joined.");
    } else if (registrationInitialLoadFailureOnly) {
      await checkRegistrationInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player registration-failure checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — A successful Player tournament list remains available when the first registration lookup fails; joined status is clearly unknown and safely updates after retry.");
    } else if (adminLargeTextInitialLoadFailureOnly) {
      await checkAdminInitialLoadFailure({ largeText: true });
      assert(
        browserErrors.length === 0,
        `Browser errors during large-text Admin initial-load recovery checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — At Android 1.5× text, a longer second-failure error stays readable, Retry remains enabled and reachable at 48px+, and a subsequent retry loads tournaments and clears the error.");
    } else if (adminInitialLoadFailureOnly) {
      await checkAdminInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin initial-load failure checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — A failed first Admin tournament load shows a visible Retry control; retrying loads cards and clears the error.");
    } else if (refreshCoalescingOnly) {
      await checkTournamentRefreshCoalescing();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player refresh-coalescing checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Manual pulls coalesce with pending app-resume reads; success updates cards, failure preserves them with one error, and refresh settles.");
    } else if (refreshReturnOnly) {
      await checkTournamentRefreshAfterReturning();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player refresh-after-return checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Returning during a pending Player pull loads current tournament data; the old response cannot replace the card or leave refresh active.");
    } else if (manualRefreshLargeTextOnly) {
      for (const fontScale of [1.5, 2]) {
        await setViewport(320, fontScale, "tournament-resume-preview.html?manual-refresh-only=1");
        await checkTournamentManualRefresh({
          width: 320,
          fontScale,
          initialName: "Daily007 International Free Fire Championship Grand Finals",
          refreshedName: "Player Manually Refreshed Daily007 International Free Fire Championship Grand Finals",
          includeSelectedTabRefreshChecks: false,
        });
        assert(
          browserErrors.length === 0,
          `Browser errors during Player refresh checks at ${fontScale}× Android text: ${browserErrors.join(" | ")}`,
        );
      }
      console.log("PASS — At 1.5× and 2× Android text, the retained tournament card and refresh error fit without overlap; successful pulls update the card and clear the error.");
    } else if (manualRefreshOnly) {
      await checkTournamentManualRefresh();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player manual-refresh checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Player refreshes preserve the selected Ongoing and Completed tabs while updating their cards and counts; failure and recovery behavior also passes.");
    } else if (initialLoadFailureOnly) {
      await checkTournamentInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player first-load checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — The first-load error and recovery each produce one polite Player announcement, repeated errors do not repeat, cards appear, and focus stays on the Upcoming tab.");
    } else if (adminTournamentHomeRefreshOnly) {
      await checkAdminTournamentCreationAppearsOnHomeRefresh();
      console.log("PASS — Admin creation is visible in the refreshed tournament list, and Home shows it after the scheduled polling path.");
    } else if (adminTournamentEmptyFilterOnly) {
      await checkAdminTournamentEmptyFilters();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin tournament empty-filter checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Empty Admin tournament filters show the correct message without stale cards or actions, and Upcoming restores its record.");
    } else if (adminTournamentCreateSaveOnly) {
      await checkAdminTournamentCreationSaveAtLargeText();
      assert(
        browserErrors.length === 0,
        `Browser errors during large-text tournament creation checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Tournament creation at 320px/1.5× submits every entered setting and shows success.");
    } else if (adminTournamentEditSaveOnly) {
      await checkAdminTournamentEditSaveAtLargeText();
      assert(
        browserErrors.length === 0,
        `Browser errors during large-text tournament edit checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Editing an existing tournament at 320px/1.5× submits every changed setting and closes on success.");
    } else if (adminFullAdminRecoveryOnly) {
      await checkAdminFullAdminRoleRefreshRecovery();
      assert(
        browserErrors.length === 0,
        `Browser errors during Full Admin refresh-recovery checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — After an external role change during a failed-refresh recovery, the refreshed row shows Tournament Admin and the polite status does not claim Full Admin.",
      );
    } else if (adminActionsOnly) {
      await setViewport(390);
      await checkAdminSelectedRecordMutations();
      await reloadAdminPreviewForMutationFailureChecks();
      await checkAdminMutationFailureRecovery();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin mutation success and failure-recovery checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Admin successes update only the selected local preview record; rejected mutations show errors, clear busy state, preserve rows, and allow retry.",
      );
    } else if (adminKeyboardFormsOnly) {
      await checkAdminTournamentKeyboard();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin tournament keyboard checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Admin tournament creation, room setup, and result-entry actions remain visible and enabled at 375×450 with a simulated Android keyboard, and each layout recovers after dismissal.");
    } else if (adminSearchKeyboardOnly) {
      await checkAdminSearchResultsWithKeyboard();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin search keyboard checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — At 375×450 with 1.5× text and a simulated Android keyboard, Wallet and Users search results stay reachable, and Admin Users no-match recovery restores all users and roles without mutations.",
      );
    } else if (adminSearchAccessibilityOnly) {
      await checkAdminSearchAccessibility();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin search announcement checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Wallet and Users announce changed result sets politely on simulated Android and iOS paths, suppress duplicate/rapid-query speech, retain search focus, and keep filtered details/actions available.",
      );
    } else if (adminNotificationsAccessibilityOnly) {
      await checkAdminNotificationsAccessibility();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin notification accessibility checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Notification templates are labeled buttons with message-specific hints; preview activation fills both fields without moving focus or calling mutations. Fake recipients expose checkbox names and states, selection changes announce politely, and the send action and completion are labeled.",
      );
    } else if (sameTimeStartOnly) {
      await checkSimultaneousTournamentStarts();
      assert(
        browserErrors.length === 0,
        `Browser errors during simultaneous-start checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Player and Admin each announce both same-time tournament starts once in one polite update without moving focus.",
      );
    } else if (scheduledStartOnly) {
      await checkTournamentScheduledStart(0);
      await cdp("Page.navigate", {
        url: `http://127.0.0.1:${vitePort}/tournament-resume-preview.html?scheduled-start-only=1&boundary=new-year`,
      });
      await checkTournamentScheduledStart(1);
      await cdp("Page.navigate", {
        url: `http://127.0.0.1:${vitePort}/tournament-resume-preview.html?scheduled-start-only=1&boundary=leap-day`,
      });
      await checkTournamentScheduledStart(2);
      assert(
        browserErrors.length === 0,
        `Browser errors during scheduled-start checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Player and Admin cards preserve fixed month-end, New Year, and leap-day IST dates in Los Angeles time, with Upcoming/Ongoing transitions at the exact start instants.");
    } else if (istDateSurfacesOnly) {
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkIstDateSurfaces(vitePort);
      const newBrowserErrors = browserErrors.filter((error) =>
        !knownHomePreviewErrors.has(error) &&
        !error.includes("Unexpected text node: . A text node cannot be a child of a <View>."),
      );
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during IST date surface checks: ${newBrowserErrors.join(" | ")}`,
      );
      console.log("PASS — IST dates stay identical across Los Angeles, Kolkata, and Pacific/Kiritimati; New Year timestamps include the IST year only when it differs from the current IST year.");
    } else if (keyboardFormsOnly) {
      await checkWalletAndProfileKeyboard();
      assert(browserErrors.length === 0, `Browser errors during keyboard form checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Wallet recharge/withdrawal and Edit Profile actions remain reachable at 375px with a simulated keyboard-open viewport.");
    } else if (adminNotificationKeyboardOnly) {
      await checkAdminNotificationsKeyboardAcrossWidths();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin notification keyboard checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Targeted notifications remain sendable at all six requested phone widths with 1.5× text and a simulated Android keyboard.");
    } else if (homeStartTransitionOnly) {
      const width = 390;
      await checkHomeStartTransitionSelection(width);
      assert(
        browserErrors.length === 0,
        `Browser errors during Home scheduled-start carousel selection checks: ${browserErrors.join(" | ")}`,
      );
    } else if (homeDisabledTournamentRefreshOnly) {
      const errorBaseline = new Set(browserErrors);
      await checkDisabledTournamentDisappearsAfterHomeRefresh();
      const newBrowserErrors = browserErrors.filter((error) => !errorBaseline.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during disabled-tournament Home refresh checks: ${newBrowserErrors.join(" | ")}`,
      );
      console.log("PASS — Admin closes the populated tournament, the enabled public list excludes it, and Home's scheduled poll removes only its card.");
    } else if (homeRefreshOverlapOnly) {
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkHomeRefreshOverlap();
      const newBrowserErrors = browserErrors.filter((error) => !knownHomePreviewErrors.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during Home refresh overlap checks: ${newBrowserErrors.join(" | ")}`,
      );
    } else if (homeQueuedAwayOnly) {
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkHomeQueuedRefreshWhenAway();
      const newBrowserErrors = browserErrors.filter((error) => !knownHomePreviewErrors.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during queued Home refresh focus checks: ${newBrowserErrors.join(" | ")}`,
      );
    } else if (homeInitialRetryOnly) {
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkHomeInitialLoadRetry();
      const newBrowserErrors = browserErrors.filter((error) => !knownHomePreviewErrors.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during Home initial-load retry checks: ${newBrowserErrors.join(" | ")}`,
      );
    } else if (homeRetryOnly) {
      await waitForCondition(
        "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
        "Home to finish its initial render before the retry recovery check",
      );
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkHomeRetryRecovery();
      const newBrowserErrors = browserErrors.filter((error) => !knownHomePreviewErrors.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during Home retry recovery checks: ${newBrowserErrors.join(" | ")}`,
      );
    } else if (singleHomeCardOnly) {
      const knownHomePreviewErrors = new Set(browserErrors);
      await checkSingleHomeCarouselCard(390);
      const newBrowserErrors = browserErrors.filter((error) => !knownHomePreviewErrors.has(error));
      assert(
        newBrowserErrors.length === 0,
        `New browser errors during one-card Home activation checks: ${newBrowserErrors.join(" | ")}`,
      );
    } else if (homeCarouselOnly) {
      let homePreviewErrorBaseline;
      for (const width of [320, 430]) {
        await setViewport(width, 1, "home-carousel-preview.html");
        await waitForCondition(
          "window.__daily007HomeCarouselTest?.ready === true && document.querySelectorAll('[data-testid^=\"home-upcoming-card-\"]').length === 3",
          `the Home carousel to load its three-card baseline at ${width}px`,
        );
        // The isolated Home preview already emits this React Native Web warning on first render.
        // Compare error signatures so rotation still fails on any new browser error.
        if (homePreviewErrorBaseline === undefined) {
          homePreviewErrorBaseline = new Set(browserErrors);
        }
        await checkHomeCarousel(width);
        const newBrowserErrors = browserErrors.filter((error) => !homePreviewErrorBaseline.has(error));
        assert(
          newBrowserErrors.length === 0,
          `New browser errors during Home carousel checks at ${width}px: ${newBrowserErrors.join(" | ")}`,
        );
      }
      for (const [width, fontScale] of [[320, 1.5], [320, 2], [390, 1.5], [390, 2]]) {
        await checkHomeCarouselLargeText(width, fontScale);
        const newBrowserErrors = browserErrors.filter((error) => !homePreviewErrorBaseline.has(error));
        assert(
          newBrowserErrors.length === 0,
          `New browser errors during Home carousel large-text checks at ${width}px and ${fontScale}×: ${newBrowserErrors.join(" | ")}`,
        );
      }
      console.log("PASS — Home carousel manual swipes, auto-advance, matching detail taps, scheduled-start changes, and registration-aware refreshes at 320px and 430px.");
    } else {
      await checkTournamentResume();
      assert(browserErrors.length === 0, `Browser errors during tournament resume checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Player refresh recovery works; Admins can retry failed tournament refreshes in place without losing cards.");
    }
  } else {
    for (const width of [320, 360, 375, 390, 412, 430]) {
      await setViewport(width);
      await checkAdminTabs(width);
      await checkPopulatedAdminLists(width);
      await checkTournamentStates(width);
      assert(browserErrors.length === 0, `Browser errors at ${width}px: ${browserErrors.join(" | ")}`);
      console.log(
        `PASS ${width}px — all 11 Admin tabs and populated row actions meet 48×48 Android targets; registration, payment, wallet, user, and tournament management states remain usable.`,
      );
    }

    await setViewport(320, 1.5);
    assert(
      await evaluate("window.__daily007LargeTextScale === 1.5"),
      "The compact Admin preview did not apply the requested 1.5× Android text scale.",
    );
    await checkAdminTabs(320);
    await checkTournamentStates(320, { largeText: true });
    assert(browserErrors.length === 0, `Browser errors at 320px with 1.5× text: ${browserErrors.join(" | ")}`);
    console.log("PASS 320px at 1.5× text — selected Admin tabs, tournament fields, room setup, result entry, and completed-result details fit without horizontal clipping or page overflow.");

    for (const width of [320, 360, 375, 390, 412, 430]) {
      await setViewport(width, 1.5);
      assert(
        await evaluate("window.__daily007LargeTextScale === 1.5"),
        `The Admin list preview did not apply 1.5× text at ${width}px.`,
      );
      await checkPopulatedAdminLists(width);
      await checkAdminSearchResultsAtLargeText(width);
      await checkRemainingAdminListsAtLargeText(width);
      assert(
        browserErrors.length === 0,
        `Browser errors at ${width}px with 1.5× text: ${browserErrors.join(" | ")}`,
      );
      console.log(
        `PASS ${width}px at 1.5× text — populated registration, payment, wallet, user, video, earn-task, and notification rows and actions remain usable without clipping or page overflow.`,
      );
    }

    await setViewport(390);
    await checkAdminSelectedRecordMutations();
    await reloadAdminPreviewForMutationFailureChecks();
    await checkAdminMutationFailureRecovery();
    assert(
      browserErrors.length === 0,
      `Browser errors during Admin mutation success and failure-recovery checks: ${browserErrors.join(" | ")}`,
    );
    console.log(
      "PASS — Admin successes update only the selected local preview record; rejected mutations show errors, clear busy state, preserve rows, and allow retry.",
    );
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