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
const initialLoadFailureOnly = process.argv.includes("--initial-load-failure-only");
const adminInitialLoadFailureOnly = process.argv.includes("--admin-initial-load-failure-only");
const manualRefreshOnly = process.argv.includes("--manual-refresh-only");
const homeCarouselOnly = process.argv.includes("--home-carousel-only");
const keyboardFormsOnly = process.argv.includes("--keyboard-forms-only");
const adminKeyboardFormsOnly = process.argv.includes("--admin-keyboard-forms-only");
const scheduledStartOnly = process.argv.includes("--scheduled-start-only");
const adminActionsOnly = process.argv.includes("--admin-actions-only");
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
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${vitePort}/${previewFile}?run=${width}&fontScale=${fontScale}`,
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
      action.height > 0 &&
        action.scrollHeight <= action.clientHeight + 2 &&
        action.enabled &&
        action.hitTestable,
      `${description}: the "${action.label}" action is clipped, disabled, or obscured at ${width}px ` +
        `(height=${action.height}, content=${action.scrollHeight}/${action.clientHeight}, ` +
        `enabled=${action.enabled}, hit-testable=${action.hitTestable}, ` +
        `bounds=${action.top}-${action.bottom}/${action.viewportHeight}, hit=${action.hitTarget}).`,
    );
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

async function checkAdminSelectedRecordMutations() {
  assert(
    await evaluate("Boolean(window.__daily007AdminMutations?.reset)"),
    "The isolated Admin mutation-call tracker is not installed.",
  );
  const registrationMarker =
    "Ananya Daily007 Championship Champion With A Long Name — International Free Fire Finals Squad";
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

  await resetAdminMutationCalls();
  await clickRowButton(registrationMarker, "REJECT", "pending registration");
  await assertAdminMutation({
    method: "adminRegAction",
    id: "preview-registration-pending-long-identifier-2026",
    action: "reject",
  }, "Registration rejection");

  await clickTextLabel("APPROVED");
  await resetAdminMutationCalls();
  await clickRowButton(approvedRegistrationMarker, "DELETE", "approved registration");
  await assertAdminMutation({
    method: "adminDeleteRegistration",
    id: "preview-registration-approved-2026",
  }, "Registration deletion");

  await clickSelector('[data-testid="admin-tab-payments"]', "Payments tab");
  await waitForCondition(
    "document.body.innerText.includes('Ananya Championship Participant With A Long Display Name')",
    "the selected fake deposit to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(
    "Ananya Championship Participant With A Long Display Name · User ID: preview-user-ananya-championship-account-2026",
    "APPROVE",
    "pending deposit",
  );
  await assertAdminMutation({
    method: "adminPaymentAction",
    id: "preview-payment-pending-long-reference-2026",
    action: "approve",
  }, "Deposit approval");

  await resetAdminMutationCalls();
  await clickRowButton(
    "Rohan International Tournament Champion · User ID: preview-user-rohan-championship-account-2026",
    "REJECT",
    "pending withdrawal",
  );
  await assertText("Reject request", "the withdrawal rejection dialog");
  await setLastVisibleInput("Preview rejection reason", "withdrawal rejection reason");
  await clickDialogButton("Reject request", "REJECT", "withdrawal rejection dialog");
  await assertAdminMutation({
    method: "adminWithdrawalAction",
    id: "preview-withdrawal-pending-long-reference-2026",
    action: "reject",
    reason: "Preview rejection reason",
  }, "Withdrawal rejection");

  await clickTextLabel("APPROVED");
  await waitForCondition(
    "document.body.innerText.includes('Approved Preview Payout Player · User ID: preview-user-approved-payout-2026')",
    "the selected approved withdrawal to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(
    "Approved Preview Payout Player · User ID: preview-user-approved-payout-2026",
    "RECORD MANUAL PAYOUT SENT",
    "approved withdrawal",
  );
  await assertText("Record manual payout", "the manual payout confirmation");
  await clickDialogButton("Record manual payout", "MARK PAID", "manual payout confirmation");
  await assertAdminMutation({
    method: "adminMarkWithdrawalPaid",
    id: "preview-withdrawal-approved-manual-payout-2026",
  }, "Manual withdrawal payout");

  await clickSelector('[data-testid="admin-tab-wallet"]', "Wallet tab");
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the selected fake Wallet user to load",
  );
  await resetAdminMutationCalls();
  await clickRowButton(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    "+ ADD",
    "Wallet user",
  );
  await assertText("Add coins", "the Wallet coin adjustment dialog");
  await setLastVisibleInput("321", "Wallet coin amount");
  await clickDialogButton("Add coins", "ADD", "Wallet coin adjustment dialog");
  await assertAdminMutation({
    method: "adminAdjustCoins",
    userId: "preview-user-ananya-championship-2026",
    amount: 321,
    reason: "Admin added coins",
  }, "Wallet coin addition");

  await resetAdminMutationCalls();
  await clickRowButton(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    "− DEDUCT",
    "Wallet user",
  );
  await assertText("Deduct coins", "the Wallet deduction dialog");
  await setLastVisibleInput("87", "Wallet coin deduction amount");
  await clickDialogButton("Deduct coins", "DEDUCT", "Wallet deduction dialog");
  await assertAdminMutation({
    method: "adminAdjustCoins",
    userId: "preview-user-ananya-championship-2026",
    amount: -87,
    reason: "Admin deducted coins",
  }, "Wallet coin deduction");

  await clickSelector('[data-testid="admin-tab-users"]', "Users tab");
  await waitForCondition(
    "document.body.innerText.includes('ananya.champion.with.a.long.fake.address@example.invalid')",
    "the selected fake Admin user to load",
  );
  const userId = "preview-user-ananya-championship-2026";
  await resetAdminMutationCalls();
  await clickSelector(`[data-testid="change-user-role-${userId}"]`, "user role action");
  await clickSelector('[data-testid="confirm-tournament-admin-change"]', "confirm user role action");
  await assertAdminMutation({
    method: "adminSetUserRole",
    id: userId,
    role: "tournament_admin",
  }, "User role change");

  await resetAdminMutationCalls();
  await clickRowButton(
    "ananya.champion.with.a.long.fake.address@example.invalid",
    "BLOCK",
    "Admin user",
  );
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

  const otherUserEmail = "rohan.preview.player@example.invalid";
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
}

async function checkTournamentStates(width, { largeText = false } = {}) {
  await clickSelector('[data-testid="admin-tab-tournaments"]', "Tournaments tab");
  if (largeText) await assertTournamentStatusTabsFit(width);

  await clickButton("NEW");
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
  if (largeText) {
    await assertVisibleAdminControlsFit(width, "Tournament creation form");
    await assertPageHasNoHorizontalOverflow(width, "Tournament creation form");
    await assertVisibleTextFits(
      '[data-testid="admin-tournament-create-form"]',
      width,
      "Tournament creation form",
    );
  }
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
  if (largeText) {
    await assertVisibleAdminControlsFit(width, "Room setup");
    await assertPageHasNoHorizontalOverflow(width, "Room setup");
    await assertVisibleTextFits(
      '[data-testid="inline-room-management-preview-upcoming"]',
      width,
      "Room setup",
    );
  }

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
  await assertHorizontalFit('[data-testid="result-rank-preview-ongoing"]', "Result rank field", width);
  await assertHorizontalFit('[data-testid="result-kills-preview-ongoing"]', "Result kills field", width);
  await assertHorizontalFit('[data-testid="inline-results-entry-preview-ongoing"]', "Result entry panel", width);
  if (largeText) {
    await assertVisibleAdminControlsFit(width, "Result entry");
    await assertPageHasNoHorizontalOverflow(width, "Result entry");
    await assertVisibleTextFits(
      '[data-testid="inline-results-entry-preview-ongoing"]',
      width,
      "Result entry",
    );
  }

  await clickSelector('[data-testid="admin-tournament-tab-completed"]', "Completed tournament filter");
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
  if (largeText) {
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

  const readsAfterFailure = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.retryAfterInitialLoadFailure()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsAfterFailure} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Could not load tournaments: Initial tournament request failed')`,
    "a later successful Player load to show the tournament and clear the initial error",
  );
  await assertText("IST Start Boundary", "the Player tournament after the successful retry");
  assert(
    !await evaluate("document.body.innerText.includes('Could not load tournaments')"),
    "A successful Player load must clear the initial-load error.",
  );
}

async function checkAdminInitialLoadFailure() {
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
    !await evaluate("document.body.innerText.includes('IST Start Boundary')"),
    "An Admin initial-load failure must not show a tournament card before data loads.",
  );
  const retryVisible = await evaluate(`(() => {
    const retry = document.querySelector('[data-testid="admin-tournament-refresh-retry"]');
    if (!retry) return false;
    const rect = retry.getBoundingClientRect();
    const style = getComputedStyle(retry);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !retry.disabled;
  })()`);
  assert(retryVisible, "The Admin initial-load Retry control must be visible and enabled.");

  const readsBeforeRetry = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await clickSelector(
    '[data-testid="admin-tournament-refresh-retry"]',
    "Admin initial-load Retry",
  );
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRetry} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Could not load tournaments') && !document.body.innerText.includes('Could not refresh tournaments')`,
    "a successful Admin retry to show tournament cards and clear the initial-load error",
  );
  await assertText("IST Start Boundary", "the Admin tournament after initial-load recovery");
  assert(
    !await evaluate("document.body.innerText.includes('Could not load tournaments')"),
    "A successful Admin retry must clear the initial-load error.",
  );
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
  await evaluate("window.__daily007TournamentResume.failNextTournamentRead()");
  await triggerPlayerManualRefresh();
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRefresh} && document.body.innerText.includes('Could not refresh tournaments: Temporary network error') && document.body.innerText.includes('IST Start Boundary')`,
    "the failed manual refresh to show an error and preserve the loaded Player card",
  );
  await assertText("IST Start Boundary", "the Player tournament after a failed manual refresh");
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
    `window.__daily007TournamentResume.getTournamentReadCount() > ${readsBeforeRefresh} && document.body.innerText.includes('Player Manually Refreshed IST Start Boundary') && !document.body.innerText.includes('Could not refresh tournaments: Temporary network error')`,
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

async function assertNearMidnightIstSchedule(screenName) {
  const schedule = await evaluate("window.__daily007TournamentResume.getScheduledStartInfo()");
  assert(
    schedule.browserTimeZone === "America/Los_Angeles",
    `${screenName} scheduled-start test must run with a non-IST browser timezone.`,
  );
  assert(
    schedule.istTime === "00:00:01",
    `${screenName} tournament must start one second after midnight IST, got ${schedule.istTime}.`,
  );
  assert(
    schedule.beforeIstTime.startsWith("23:59:59") &&
      schedule.beforeIstDate !== schedule.istDate,
    `${screenName} clock must cross the IST calendar date at the scheduled start.`,
  );
  assert(
    schedule.utcDate !== schedule.istDate,
    `${screenName} scheduled start must fall on a different UTC date than IST.`,
  );
  assert(
    schedule.startsAt.endsWith("+05:30") &&
      Date.parse(schedule.startsAt) === schedule.startMs,
    `${screenName} scheduled timestamp must preserve the correct IST offset and instant.`,
  );
  return schedule;
}

async function checkTournamentScheduledStart() {
  await waitForCondition(
    "window.__daily007TournamentResume?.ready === true",
    "the timed-start preview to initialize",
  );
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary') && document.body.innerText.includes('Later IST Tournament Boundary')",
    "the player list to load both upcoming IST tournaments",
  );
  const playerSchedule = await assertNearMidnightIstSchedule("Player");
  const playerDateTime = `${playerSchedule.istDateLabel} • ${playerSchedule.time} IST`;
  assert(
    await evaluate(`document.body.innerText.includes(${JSON.stringify(playerDateTime)})`),
    `Player card must display its IST date and time (${playerDateTime}) in a non-IST browser timezone.`,
  );

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
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Later IST Tournament Boundary')`,
    "the player list timer to move only the first tournament into Ongoing",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforePlayerStarts,
    "The first player start-time transition must not depend on an AppState visibility/resume event.",
  );
  await assertText("IST Start Boundary", "the first player tournament after its scheduled start");
  await clickSelector('[data-testid="tournament-tab-upcoming"]', "player Upcoming filter");
  await waitForCondition(
    "document.body.innerText.includes('Later IST Tournament Boundary') && !document.body.innerText.includes('IST Start Boundary')",
    "the later player tournament to remain Upcoming after the first start",
  );
  await clickSelector('[data-testid="tournament-tab-ongoing"]', "player Ongoing filter");
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastSecondStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary') && document.body.innerText.includes('Later IST Tournament Boundary')`,
    "the player list timer to move the later tournament into Ongoing at its own start",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforePlayerStarts,
    "The second player start-time transition must not depend on an AppState visibility/resume event.",
  );
  await assertText("IST Start Boundary", "the first player tournament after both scheduled starts");
  await assertText("Later IST Tournament Boundary", "the later player tournament after its scheduled start");

  await evaluate("window.__daily007TournamentResume.prepareAdminForScheduledStart()");
  await evaluate("window.__daily007TournamentResume.showAdmin()");
  await waitForCondition(
    "window.__daily007TournamentResume.getTournamentReadCount() > 0 && document.body.innerText.includes('IST Start Boundary') && document.body.innerText.includes('Later IST Tournament Boundary')",
    "the Admin list to load both upcoming IST tournaments",
  );
  const adminSchedule = await assertNearMidnightIstSchedule("Admin");
  const adminDateTime = `${adminSchedule.date} • ${adminSchedule.time} IST`;
  assert(
    await evaluate(`document.body.innerText.includes(${JSON.stringify(adminDateTime)})`),
    `Admin card must display its IST date and time (${adminDateTime}) in a non-IST browser timezone.`,
  );
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
  await evaluate("window.__daily007TournamentResume.advanceClockPastFirstStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary') && !document.body.innerText.includes('Later IST Tournament Boundary') && document.body.innerText.includes('Could not refresh tournaments: Temporary network error')`,
    "the Admin clock to move only the first tournament into Ongoing even when its scheduled refresh fails",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeAdminStarts,
    "The first Admin start-time transition must not depend on an app background/resume event.",
  );
  await assertText("IST Start Boundary", "the first Admin tournament after its scheduled start");
  await clickSelector('[data-testid="admin-tournament-tab-upcoming"]', "Admin Upcoming filter");
  await waitForCondition(
    "document.body.innerText.includes('Later IST Tournament Boundary') && !document.body.innerText.includes('IST Start Boundary')",
    "the later Admin tournament to remain Upcoming after the first start",
  );
  await clickSelector('[data-testid="admin-tournament-tab-ongoing"]', "Admin Ongoing filter");
  tournamentReads = await evaluate("window.__daily007TournamentResume.getTournamentReadCount()");
  await evaluate("window.__daily007TournamentResume.advanceClockPastSecondStart()");
  await waitForCondition(
    `window.__daily007TournamentResume.getTournamentReadCount() > ${tournamentReads} && document.body.innerText.includes('IST Start Boundary') && document.body.innerText.includes('Later IST Tournament Boundary') && !document.body.innerText.includes('Could not refresh tournaments: Temporary network error')`,
    "the Admin list timer to move the later tournament into Ongoing at its own start",
  );
  assert(
    await evaluate("window.__daily007TournamentResume.getVisibilityChangeCount()") === visibilityChangesBeforeAdminStarts,
    "The second Admin start-time transition must not depend on an app background/resume event.",
  );
  assert(
    !await evaluate("document.body.innerText.includes('Could not refresh tournaments: Temporary network error')"),
    "A successful scheduled Admin refresh should clear the earlier request error.",
  );
  await assertText("IST Start Boundary", "the first Admin tournament after both scheduled starts");
  await assertText("Later IST Tournament Boundary", "the later Admin tournament after its scheduled start");
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

async function assertHomeCarouselCardOpens(id, description) {
  await tapSelector(`[data-testid="home-upcoming-card-${id}"]`, description);
  const navigations = await evaluate("globalThis.__previewNavigations ?? []");
  assert(
    JSON.stringify(navigations.at(-1)) === JSON.stringify(["TDetail", { id }]),
    `${description} opened the wrong tournament details: ${JSON.stringify(navigations.at(-1))}.`,
  );
}

async function checkHomeCarousel(width) {
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

  await swipeHomeCarousel("left", "the first Upcoming tournament");
  await waitForHomeCarouselCard("later-one", 1, width, "The second Upcoming tournament after a manual swipe");
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
  await assertHomeCarouselCardOpens("later-one", "The first remaining tournament");
  await swipeHomeCarousel("left", "the first remaining tournament");
  await waitForHomeCarouselCard("later-two", 1, width, "The second remaining tournament after a manual swipe");
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
  await evaluate(`window.__daily007HomeCarouselTest.setRegistrations([
    { id: "preview-registration-later-one", tournamentId: "later-one", status: "rejected" }
  ])`);
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

let vitePort;

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-admin-narrow-"));
  const previewPath = adminInitialLoadFailureOnly
    ? "tournament-resume-preview.html?admin-initial-load-failure-only=1"
    : manualRefreshOnly
      ? "tournament-resume-preview.html?manual-refresh-only=1"
    : initialLoadFailureOnly
    ? "tournament-resume-preview.html?initial-load-failure-only=1"
    : resumeOnly
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
  if (scheduledStartOnly) {
    await cdp("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
    await cdp("Page.reload", { ignoreCache: true });
  }
  if (
    resumeOnly ||
    initialLoadFailureOnly ||
    adminInitialLoadFailureOnly ||
    manualRefreshOnly ||
    scheduledStartOnly ||
    homeCarouselOnly ||
    keyboardFormsOnly ||
    adminKeyboardFormsOnly ||
    adminActionsOnly
  ) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: homeCarouselOnly || scheduledStartOnly || adminActionsOnly
        || initialLoadFailureOnly || adminInitialLoadFailureOnly || manualRefreshOnly
        ? 390
        : keyboardFormsOnly || adminKeyboardFormsOnly ? 375 : 800,
      height: homeCarouselOnly || scheduledStartOnly || adminActionsOnly
        || initialLoadFailureOnly || adminInitialLoadFailureOnly || manualRefreshOnly
        ? 844
        : keyboardFormsOnly || adminKeyboardFormsOnly ? 720 : 1000,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForPage(
      homeCarouselOnly
        ? "Home carousel"
        : initialLoadFailureOnly
          ? "Player first-load failure"
        : adminInitialLoadFailureOnly
          ? "Admin first-load failure"
        : manualRefreshOnly
          ? "Player pull-to-refresh"
        : scheduledStartOnly
          ? "scheduled-start Player and Admin tournament screens"
        : keyboardFormsOnly
          ? "Wallet and Edit Profile"
        : adminKeyboardFormsOnly
          ? "Admin tournament keyboard forms"
        : adminActionsOnly
          ? "Admin selected-record actions"
          : "player and Admin tournament screens",
    );
    if (adminInitialLoadFailureOnly) {
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
      console.log("PASS — Failed Player pull-to-refresh keeps the loaded card visible; a later manual refresh updates it and clears the error.");
    } else if (initialLoadFailureOnly) {
      await checkTournamentInitialLoadFailure();
      assert(
        browserErrors.length === 0,
        `Browser errors during Player first-load checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — A failed first Player tournament load shows the correct error with no cards; a later successful load shows the card and clears the error.");
    } else if (adminActionsOnly) {
      await setViewport(390);
      await checkAdminSelectedRecordMutations();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin selected-record action checks: ${browserErrors.join(" | ")}`,
      );
      console.log(
        "PASS — Registration, payment, withdrawal, wallet, and user actions submit the selected fake record and intended operation through the isolated Admin API mock.",
      );
    } else if (adminKeyboardFormsOnly) {
      await checkAdminTournamentKeyboard();
      assert(
        browserErrors.length === 0,
        `Browser errors during Admin tournament keyboard checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Admin tournament creation, room setup, and result-entry actions remain visible and enabled at 375×450 with a simulated Android keyboard, and each layout recovers after dismissal.");
    } else if (scheduledStartOnly) {
      await checkTournamentScheduledStart();
      assert(
        browserErrors.length === 0,
        `Browser errors during scheduled-start checks: ${browserErrors.join(" | ")}`,
      );
      console.log("PASS — Player and Admin tournament cards cross midnight IST, display the correct IST date/time, and move from Upcoming to Ongoing without AppState events.");
    } else if (keyboardFormsOnly) {
      await checkWalletAndProfileKeyboard();
      assert(browserErrors.length === 0, `Browser errors during keyboard form checks: ${browserErrors.join(" | ")}`);
      console.log("PASS — Wallet recharge/withdrawal and Edit Profile actions remain reachable at 375px with a simulated keyboard-open viewport.");
    } else if (homeCarouselOnly) {
      for (const width of [320, 430]) {
        await setViewport(width, 1, "home-carousel-preview.html");
        await checkHomeCarousel(width);
        assert(
          browserErrors.length === 0,
          `Browser errors during Home carousel checks at ${width}px: ${browserErrors.join(" | ")}`,
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
        `PASS ${width}px — all 11 Admin tabs, populated registration/payment/wallet/user rows and actions, and tournament management states.`,
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
      assert(
        browserErrors.length === 0,
        `Browser errors at ${width}px with 1.5× text: ${browserErrors.join(" | ")}`,
      );
      console.log(
        `PASS ${width}px at 1.5× text — populated registration, payment, wallet, and user rows and actions fit without clipping or page overflow.`,
      );
    }

    await setViewport(390);
    await checkAdminSelectedRecordMutations();
    assert(
      browserErrors.length === 0,
      `Browser errors during Admin selected-record action checks: ${browserErrors.join(" | ")}`,
    );
    console.log(
      "PASS — Registration, payment, withdrawal, wallet, and user actions submit the selected fake record and intended operation through the isolated Admin API mock.",
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