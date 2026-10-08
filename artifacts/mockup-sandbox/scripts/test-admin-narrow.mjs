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
const adminInitialLoadFailureOnly = process.argv.includes("--admin-initial-load-failure-only");
const adminLargeTextInitialLoadFailureOnly = process.argv.includes("--admin-initial-load-failure-large-text-only");
const adminRetryConcurrencyOnly = process.argv.includes("--admin-retry-concurrency-only");
const manualRefreshOnly = process.argv.includes("--manual-refresh-only");
const homeCarouselOnly = process.argv.includes("--home-carousel-only");
const istDateSurfacesOnly = process.argv.includes("--ist-date-surfaces-only");
const keyboardFormsOnly = process.argv.includes("--keyboard-forms-only");
const adminKeyboardFormsOnly = process.argv.includes("--admin-keyboard-forms-only");
const adminTournamentCreateSaveOnly = process.argv.includes("--admin-tournament-create-save-only");
const scheduledStartOnly = process.argv.includes("--scheduled-start-only");
const adminActionsOnly = process.argv.includes("--admin-actions-only");
const adminLandscapeOnly = process.argv.includes("--admin-landscape-only");
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

async function setViewport(width, fontScale = 1, previewFile = "admin-narrow-preview.html") {
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
    };
  })()`);
  assert(bounds?.width > 0 && bounds.height > 0, `Could not locate the Home carousel for ${description}.`);
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const distance = Math.round(bounds.width * 0.64);
  const startX = Math.round(bounds.left + bounds.width * (direction === "left" ? 0.82 : 0.18));
  const endX = startX + (direction === "left" ? -distance : distance);
  const y = Math.round(bounds.top + bounds.height / 2);
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
  await openAdminTab("registrations", "Registrations", { requireReachability });
  await waitForCondition(
    "document.body.innerText.includes('Ananya Daily007 Championship Champion With A Long Name')",
    "the fake pending registration to load",
  );
  await assertAdminRowActionsFit(
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad",
    ["APPROVE", "REJECT"],
    width,
    "Pending registration",
    { requireReachability },
  );

  await clickTextLabel("APPROVED");
  await assertAdminRowActionsFit(
    "Rohan Free Fire Strategist — Preview Approved Team",
    ["DELETE"],
    width,
    "Approved registration",
    { requireReachability },
  );
  await clickTextLabel("REJECTED");
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

async function assertAdminSearchField(testId, value, width, description) {
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
    { excludes: ["RECORD MANUAL PAYOUT SENT"] },
    "the withdrawal with its manual payout recorded",
  );
  await assertAdminRecordState(
    approvedPayoutControlMarker,
    { includes: ["RECORD MANUAL PAYOUT SENT"] },
    "the unrelated approved withdrawal",
  );
  await assertAdminRecordState(
    withdrawalToApproveMarker,
    { includes: ["RECORD MANUAL PAYOUT SENT"] },
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
    await failNextAdminMutation(method, error);
    await failAction();
    await assertAdminMutationFailure(error, success, description);
    await assertUnchanged();
    await resetAdminMutationCalls();
    await retryAction();
  };

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
        { includes: ["RECORD MANUAL PAYOUT SENT"] },
        "the payout still awaiting payment",
      );
      await assertAdminRecordState(
        approvedPayoutControlMarker,
        { includes: ["RECORD MANUAL PAYOUT SENT"] },
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
        { excludes: ["RECORD MANUAL PAYOUT SENT"] },
        "the payout after its retry",
      );
      await assertAdminRecordState(
        approvedPayoutControlMarker,
        { includes: ["RECORD MANUAL PAYOUT SENT"] },
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

  const readsBeforeRetry = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
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
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRetry} && document.body.innerText.includes(${JSON.stringify(recoveredTournamentName)}) && !document.body.innerText.includes('Could not load tournaments') && !document.body.innerText.includes('Could not refresh tournaments')`,
    "a successful Admin retry to show tournament cards and clear the initial-load error",
  );
  await assertText(recoveredTournamentName, "the Admin tournament after initial-load recovery");
  assert(
    !await evaluate("document.body.innerText.includes('Could not load tournaments')"),
    "A successful Admin retry must clear the initial-load error.",
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
      && pendingRetryState?.accessibilityLabel === "Retry tournament refresh"
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

  const readsBeforeRecovery = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await tapSelector(retrySelector, "re-enabled Admin Retry control");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRecovery} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Could not load tournaments')`,
    "a subsequent Admin retry to load the tournament and clear the error",
  );
  await assertText("IST Start Boundary", "the Admin tournament after retry becomes reusable");
}

async function triggerPlayerManualRefresh() {
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await tapSelector(
    '[data-testid="player-refresh-control-test-action"]',
    "Player pull-to-refresh control",
  );
}

async function checkTournamentManualRefresh() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the Player pull-to-refresh preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary')",
    "the Player list to load its tournament before manual refresh",
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
    `document.body.innerText.includes('Could not refresh tournaments: Held Player refresh failed') && document.body.innerText.includes('IST Start Boundary') && document.querySelector('[data-testid="player-refresh-control-pending"]')?.textContent === 'Ready'`,
    "the failed Player refresh to show one error, preserve the loaded card, and stop refreshing",
  );
  await assertText("IST Start Boundary", "the Player tournament after a failed manual refresh");
  const refreshErrorAccessibility = await evaluate(`(() => {
    const container = document.querySelector('[data-testid="player-tournament-refresh-error"]');
    const liveRegion = container?.querySelector('[aria-live]');
    return {
      liveRegion: liveRegion?.getAttribute('aria-live') ?? null,
      label: liveRegion?.getAttribute('aria-label') ?? null,
      cardVisible: document.body.innerText.includes('IST Start Boundary'),
      announcements: window.__daily007TournamentResume.getLoadAnnouncementEvents()
        .filter((event) => event.testID === 'player-tournament-refresh-error'),
    };
  })()`);
  assert(
    refreshErrorAccessibility.liveRegion === 'polite',
    `A failed refresh must expose its error as a polite TalkBack live region: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    refreshErrorAccessibility.label === 'Could not refresh tournaments: Temporary network error',
    `A failed refresh must have a clear accessible label: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    refreshErrorAccessibility.cardVisible,
    `The existing tournament must remain visible with the refresh announcement: ${JSON.stringify(refreshErrorAccessibility)}.`,
  );
  assert(
    JSON.stringify(refreshErrorAccessibility.announcements) === JSON.stringify([{
      testID: 'player-tournament-refresh-error',
      text: 'Could not refresh tournaments: Temporary network error',
    }]),
    `A single failed refresh should produce one clear announcement: ${JSON.stringify(refreshErrorAccessibility.announcements)}.`,
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
    "window.__daily007TournamentResume.updateTournament({ name: 'Player Manually Refreshed IST Start Boundary' })",
  );
  readsBeforeRefresh = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() === ${readsBeforeRefresh + 1} && document.body.innerText.includes('Player Manually Refreshed IST Start Boundary') && !document.body.innerText.includes('Could not refresh tournaments: Held Player refresh failed')`,
    "a later successful manual refresh to update the Player card and clear its error",
  );
  await assertText(
    "Player Manually Refreshed IST Start Boundary",
    "the updated Player tournament after manual refresh",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeRefresh,
    "The successful manual refresh must not depend on an AppState resume event.",
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
  await assertClockImmediatelyBeforeIstBoundary("Player", playerScheduleInfo, expected, 0);
  for (const schedule of playerScheduleInfo.schedules) {
    const playerDateTime = `${schedule.istDateLabel} • ${schedule.time} IST`;
    assert(
      await evaluate(`document.body.innerText.includes(${JSON.stringify(playerDateTime)})`),
      `Player card for ${schedule.name} must display its IST date and time (${playerDateTime}) in a non-IST browser timezone.`,
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

async function readHomeCarouselState() {
  return evaluate(`(() => {
    const carousel = document.querySelector('[data-testid="home-upcoming-carousel"]');
    const indicatorContainer = document.querySelector('[data-testid="home-upcoming-page-indicators"]');
    if (!carousel || !indicatorContainer) return null;
    const viewport = carousel.getBoundingClientRect();
    const dots = [...indicatorContainer.querySelectorAll('[data-testid^="home-upcoming-page-dot-"]')];
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
      indicatorCount: dots.length,
      activePage: dots.findIndex((dot) => Number.parseFloat(getComputedStyle(dot).width) >= 15),
    };
  })()`);
}

async function assertHomeCarouselAccessibility(cards, selectedPage, description) {
  const state = await readHomeCarouselState();
  assert(state, `${description}: the Home carousel is missing.`);
  assert(
    state.activePage === selectedPage,
    `${description}: expected selected page ${selectedPage + 1}, found ${state.activePage + 1}.`,
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
      remainingState.activePage === 0,
    `Home did not preserve and re-index the two later tournaments after the scheduled start at ${width}px: ${JSON.stringify(remainingState)}.`,
  );
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
    "window.__daily007HomeCarouselTest.getHomePollCount() === 1 && window.__daily007HomeCarouselTest.getMyRegistrationReadCount() === 1",
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

async function openAdminKeyboardViewport(height = 450) {
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await setKeyboardViewport(height);
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

  const successState = await evaluate(`({
    successVisible: document.body.innerText.includes("Tournament created successfully"),
    formClosed: !document.querySelector('[data-testid="admin-tournament-create-form"]'),
    width: window.innerWidth,
  })`);
  assert(successState?.successVisible, "The successful tournament creation message was not visible.");
  assert(successState.formClosed, "The tournament creation form remained open after success.");
  assert(successState.width === 320, "The tournament creation flow left the 320px viewport.");
}

let vitePort;

async function checkIstDateSurfaces(port) {
  const surfaces = ["Home", "MyMatches", "TDetail"];
  const phases = ["before", "after"];
  const timezoneStates = new Map();

  for (const timezoneId of ["America/Los_Angeles", "Asia/Kolkata"]) {
    await cdp("Emulation.setTimezoneOverride", { timezoneId });
    const phaseStates = new Map();
    timezoneStates.set(timezoneId, phaseStates);
    const timezoneCondition = timezoneId === "Asia/Kolkata"
      ? `["Asia/Kolkata", "Asia/Calcutta"].includes(Intl.DateTimeFormat().resolvedOptions().timeZone)`
      : `Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(timezoneId)}`;

    for (const phase of phases) {
      const states = new Map();
      phaseStates.set(phase, states);

      for (const screen of surfaces) {
        const params = new URLSearchParams({
          "ist-date-surfaces": "1",
          "ist-date-phase": phase,
          screen,
        });
        await cdp("Page.navigate", {
          url: `http://127.0.0.1:${port}/home-carousel-preview.html?${params}`,
        });
        if (screen === "MyMatches") {
          await waitForCondition(
            `${timezoneCondition} && window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("MY MATCHES")`,
            `My Matches to mount in ${timezoneId}`,
          );
          if (phase === "after") {
            await evaluate(`document.querySelector('[data-testid="my-matches-tab-ongoing"]')?.click()`);
          }
        }
        const readyCondition = screen === "Home"
          ? phase === "before"
            ? `window.__daily007HomeCarouselTest?.ready === true && document.querySelector('[data-testid="home-upcoming-card-starting-soon"]')?.innerText.includes("01 JAN")`
            : `window.__daily007HomeCarouselTest?.ready === true && !document.querySelector('[data-testid="home-upcoming-card-starting-soon"]') && document.body.innerText.includes("Later Tournament One")`
          : screen === "MyMatches"
            ? phase === "before"
              ? `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: 01 JAN 2030") && document.body.innerText.includes("CONFIRMED")`
              : `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: 01 JAN 2030") && document.body.innerText.includes("ONGOING") && !document.body.innerText.includes("CONFIRMED")`
            : phase === "before"
              ? `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: 01 JAN 2030") && document.body.innerText.includes("UPCOMING")`
              : `window.__daily007IstDateSurfacePreview?.ready === true && document.body.innerText.includes("SCHEDULED START: 01 JAN 2030") && document.body.innerText.includes("ONGOING") && !document.body.innerText.includes("UPCOMING")`;
        await waitForCondition(
          `${timezoneCondition} && (${readyCondition})`,
          `${screen} to render the ${phase}-start IST state in ${timezoneId}`,
        );

        const state = await evaluate(`(() => {
          const bodyText = document.body.innerText;
          const homeCard = document.querySelector('[data-testid="home-upcoming-card-starting-soon"]');
          const text = ${JSON.stringify(screen)} === "Home" ? (homeCard?.innerText ?? "") : bodyText;
          const lifecycle = ${JSON.stringify(screen)} === "Home"
            ? (homeCard
              ? (text.includes("UPCOMING") ? "upcoming" : text.includes("ONGOING") ? "ongoing" : "unknown")
              : "ongoing")
            : ${JSON.stringify(screen)} === "MyMatches"
              ? (text.includes("SCHEDULED START: 01 JAN 2030")
                ? (text.includes("CONFIRMED") ? "upcoming" : text.includes("ONGOING") ? "ongoing" : "unknown")
                : "unknown")
              : (text.includes("SCHEDULED START: 01 JAN 2030")
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
        const expectedLifecycle = phase === "before" ? "upcoming" : "ongoing";
        assert(
          state?.lifecycle === expectedLifecycle,
          `${screen} must classify the tournament as ${expectedLifecycle} ${phase === "before" ? "before" : "after"} the same start instant in ${timezoneId}.`,
        );
        const dateIsCorrect = screen === "Home"
          ? phase === "after"
            ? state.text === "" && state.laterCardVisible
            : state.text.includes("01 JAN • 12:15 AM IST")
          : state.text.includes("01 JAN 2030") && state.text.includes("12:15 AM IST");
        assert(
          dateIsCorrect,
          `${screen} must preserve the 01 JAN 2030 IST calendar date and 12:15 AM IST start in ${timezoneId}.`,
        );
        states.set(screen, state.lifecycle);
      }
    }
  }

  for (const phase of phases) {
    for (const screen of surfaces) {
      assert(
        timezoneStates.get("America/Los_Angeles")?.get(phase)?.get(screen) ===
          timezoneStates.get("Asia/Kolkata")?.get(phase)?.get(screen),
        `${screen} lifecycle classification must not change with the browser timezone ${phase} its start.`,
      );
    }
  }
}

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-admin-narrow-"));
  const previewPath = istDateSurfacesOnly
    ? "home-carousel-preview.html?ist-date-surfaces=1"
    : adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly
    ? "tournament-resume-preview.html?admin-initial-load-failure-only=1"
    : manualRefreshOnly
      ? "tournament-resume-preview.html?manual-refresh-only=1"
    : registrationInitialLoadFailureOnly
      ? "tournament-resume-preview.html?registration-initial-load-failure-only=1"
    : initialLoadFailureOnly
    ? "tournament-resume-preview.html?initial-load-failure-only=1"
    : resumeOnly
      ? "tournament-resume-preview.html"
    : scheduledStartOnly
      ? "tournament-resume-preview.html?scheduled-start-only=1&boundary=month-end"
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
  if (scheduledStartOnly || istDateSurfacesOnly) {
    await cdp("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
    await cdp("Page.reload", { ignoreCache: true });
  }
  if (
    resumeOnly ||
    initialLoadFailureOnly ||
    registrationInitialLoadFailureOnly ||
    adminInitialLoadFailureOnly ||
    adminLargeTextInitialLoadFailureOnly ||
    adminRetryConcurrencyOnly ||
    manualRefreshOnly ||
    scheduledStartOnly ||
    istDateSurfacesOnly ||
    homeCarouselOnly ||
    keyboardFormsOnly ||
    adminKeyboardFormsOnly ||
    adminTournamentCreateSaveOnly ||
    adminActionsOnly ||
    adminLandscapeOnly
  ) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: adminLandscapeOnly
        ? 800
        : homeCarouselOnly || scheduledStartOnly || istDateSurfacesOnly || adminActionsOnly
          || initialLoadFailureOnly || registrationInitialLoadFailureOnly || adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly || manualRefreshOnly
          ? 390
          : keyboardFormsOnly || adminKeyboardFormsOnly ? 375 : 800,
      height: adminLandscapeOnly
        ? 360
        : homeCarouselOnly || scheduledStartOnly || istDateSurfacesOnly || adminActionsOnly
          || initialLoadFailureOnly || registrationInitialLoadFailureOnly || adminInitialLoadFailureOnly || adminLargeTextInitialLoadFailureOnly || adminRetryConcurrencyOnly || manualRefreshOnly
          ? 844
          : keyboardFormsOnly || adminKeyboardFormsOnly ? 720 : 1000,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForPage(
      adminLandscapeOnly
        ? "Admin landscape screens"
        : istDateSurfacesOnly
          ? "Home, My Matches, and tournament details IST date surfaces"
        : homeCarouselOnly
        ? "Home carousel"
        : initialLoadFailureOnly
          ? "Player first-load failure"
        : registrationInitialLoadFailureOnly
          ? "Player registration lookup failure"
        : adminInitialLoadFailureOnly
          ? "Admin first-load failure"
        : adminLargeTextInitialLoadFailureOnly
          ? "Admin first-load failure at 1.5× text"
        : adminRetryConcurrencyOnly
          ? "Admin Retry concurrency"
        : manualRefreshOnly
          ? "Player pull-to-refresh"
        : scheduledStartOnly
          ? "scheduled-start Player and Admin tournament screens"
        : keyboardFormsOnly
          ? "Wallet and Edit Profile"
        : adminKeyboardFormsOnly
          ? "Admin tournament keyboard forms"
        : adminTournamentCreateSaveOnly
          ? "Admin tournament creation at 320px with 1.5× text"
        : adminActionsOnly
          ? "Admin selected-record actions"
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
    } else if (adminRetryConcurrencyOnly) {
      await checkAdminRetryConcurrency();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin Retry concurrency checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Repeated taps while an Admin Retry is pending do not duplicate requests; failure re-enables the control for recovery.");
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
      console.log("PASS — At Android 1.5× text, the Admin error remains readable, Retry is visible and tappable, and a successful retry loads tournaments and clears the error.");
    } else if (adminInitialLoadFailureOnly) {
      await checkAdminInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin initial-load failure checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — A failed first Admin tournament load shows a visible Retry control; retrying loads cards and clears the error.");
    } else if (manualRefreshOnly) {
      await checkTournamentManualRefresh();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player manual-refresh checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Repeated Player pulls during a pending request send no duplicates; failure preserves the card and one error, and a later refresh recovers.");
    } else if (initialLoadFailureOnly) {
      await checkTournamentInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player first-load checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — The first-load error and recovery each produce one polite Player announcement, repeated errors do not repeat, cards appear, and focus stays on the Upcoming tab.");
    } else if (adminTournamentCreateSaveOnly) {
      await checkAdminTournamentCreationSaveAtLargeText();
      assert(
        browserErrors.length === 0,
        `Browser errors during large-text tournament creation checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Tournament creation at 320px/1.5× submits every entered setting and shows success.");
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
    } else if (scheduledStartOnly) {
      await checkTournamentScheduledStart(0);
      await cdp("Page.navigate", {
        url: `http://127.0.0.1:${vitePort}/tournament-resume-preview.html?scheduled-start-only=1&boundary=new-year`,
      });
      await checkTournamentScheduledStart(1);
      assert(
        browserErrors.length === 0,
        `Browser errors during scheduled-start checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Player and Admin cards preserve the fixed month-end and New Year IST dates in Los Angeles time, with Upcoming/Ongoing transitions at the exact start instants.");
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
      console.log("PASS — Home, My Matches, and tournament details retain 01 JAN 2030, 12:15 AM IST in Los Angeles and Kolkata, classify Upcoming before and Ongoing after the same start instant, and remove the started match from Home's Upcoming list.");
    } else if (keyboardFormsOnly) {
      await checkWalletAndProfileKeyboard();
      assert(browserErrors.length === 0, `Browser errors during keyboard form checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Wallet recharge/withdrawal and Edit Profile actions remain reachable at 375px with a simulated keyboard-open viewport.");
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