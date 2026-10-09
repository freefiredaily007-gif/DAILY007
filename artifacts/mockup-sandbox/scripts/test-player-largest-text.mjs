import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sandboxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const videoStartFailureOnly = process.argv.includes("--video-start-failure-only");
const lateVideoRewardResponseOnly = process.argv.includes("--late-video-reward-response-only");
const pendingVideoWatchStartOnly = process.argv.includes("--pending-video-watch-start-only");
const browserErrors = [];
const ignoredWebOnlyConsoleErrors = new Set([
  "BackHandler is not supported on web and should not be used.",
  "Unexpected text node: . A text node cannot be a child of a <View>.",
]);
const pending = new Map();
let viteOutput = "";
let vite;
let chromium;
let socket;
let temporaryProfile;
let vitePort;
let messageId = 0;

const screens = [
  { name: "Home", ready: "GAME MODES", control: '[data-testid="home-mode-battle-royale"]' },
  { name: "Video", ready: "Tutorial Videos", control: '[data-testid="video-catalog-card-large-video-01"]' },
  { name: "Earn", ready: "EARN COINS", control: '[data-testid="referral-share-invite"]' },
  { name: "Tournaments", ready: "ALL TOURNAMENTS", control: '[data-testid="tournament-tab-upcoming"]' },
  { name: "MyMatches", ready: "MY MATCHES", control: '[data-testid="my-matches-tab-upcoming"]' },
  { name: "Wallet", ready: "WALLET", control: '[data-testid="wallet-open-recharge"]' },
  { name: "Profile", ready: "PROFILE", control: '[data-testid="profile-change-password"]' },
  { name: "Leaderboard", ready: "LEADERBOARD", control: '[data-testid="preview-back-button"]' },
  {
    name: "LeaderboardDetails",
    ready: "WEEKLY PRIZES",
    control: '[data-testid="leaderboard-details-tab-monthly"]',
  },
  { name: "Notifications", ready: "NOTIFICATIONS", control: '[data-testid="preview-back-button"]' },
  { name: "EditProfile", ready: "EDIT PROFILE", control: '[data-testid="edit-profile-save"]' },
  { name: "JoinForm", ready: "SOLO REGISTRATION", control: '[data-testid="join-form-submit"]' },
];
const walletCancellationRefundDescription =
  "Entry fee refunded — Daily007 Clash Finals (tournament cancelled)";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserErrorForCdpEvent(method, params = {}) {
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails;
    return details?.exception?.description ?? details?.text ?? "Browser exception.";
  }
  if (method !== "Runtime.consoleAPICalled" || params.type !== "error") return null;

  const message = params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    || "Browser console error.";
  return ignoredWebOnlyConsoleErrors.has(message) ? null : message;
}

function verifyBrowserErrorPolicy() {
  assert(
    browserErrorForCdpEvent("Runtime.consoleAPICalled", {
      type: "error",
      args: [{ value: "BackHandler is not supported on web and should not be used." }],
    }) === null,
    "The exact React Native Web BackHandler warning should be ignored by the browser harness.",
  );
  assert(
    browserErrorForCdpEvent("Runtime.consoleAPICalled", {
      type: "error",
      args: [{ value: "Unexpected text node: . A text node cannot be a child of a <View>." }],
    }) === null,
    "The exact React Native Web text-node warning should be ignored by the browser harness.",
  );
  assert(
    browserErrorForCdpEvent("Runtime.consoleAPICalled", {
      type: "error",
      args: [{ value: "Unexpected browser console failure." }],
    }) === "Unexpected browser console failure.",
    "Unexpected browser console errors must remain fatal.",
  );
  assert(
    browserErrorForCdpEvent("Runtime.exceptionThrown", {
      exceptionDetails: {
        exception: { description: "TypeError: Unexpected browser exception." },
        text: "Uncaught",
      },
    }) === "TypeError: Unexpected browser exception.",
    "Browser exceptions must remain fatal.",
  );
  console.log("PASS — only exact known React Native Web preview warnings are ignored.");
}

verifyBrowserErrorPolicy();

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
        const browserError = browserErrorForCdpEvent(message.method, message.params);
        if (browserError !== null) browserErrors.push(browserError);
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
    root: document.querySelector('#root')?.innerHTML.slice(0, 500) ?? ''
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(`${description} did not render: ${JSON.stringify(state)}`);
}

async function navigateToScreen(name, readyText, fontScale = 2) {
  const query = new URLSearchParams({ screen: name, fontScale: String(fontScale) });
  await cdp("Page.navigate", { url: `http://127.0.0.1:${vitePort}/player-largest-text-preview.html?${query}` });
  await waitForCondition(
    `Boolean(document.querySelector('[data-testid="player-screen"]') && document.body.innerText.includes(${JSON.stringify(readyText)}))`,
    `${name} screen`,
  );
  await delay(120);
}

async function clickSelector(selector, description) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `Could not find ${description}.`);
  await delay(120);
}

async function clickButtonWithText(text, description) {
  const clicked = await evaluate(`(() => {
    const target = [...document.querySelectorAll('button')]
      .find((button) => button.innerText.includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `Could not find ${description}.`);
  await delay(120);
}

async function setInputValue(selector, value, description) {
  const updated = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert(updated, `Could not enter ${description}.`);
}

async function setPreviewViewport(width, height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(120);
}

async function assertInputValues(selectors, expectedValues, stage) {
  const values = await evaluate(`(() => {
    const selectors = ${JSON.stringify(selectors)};
    return selectors.map((selector) => document.querySelector(selector)?.value ?? null);
  })()`);
  assert(
    JSON.stringify(values) === JSON.stringify(expectedValues),
    `Input values changed ${stage}: ${JSON.stringify(values)}`,
  );
}

async function inspectLayout(screenName) {
  return evaluate(`(() => {
    const root = document.querySelector('[data-testid="player-screen"]');
    if (!root) return { missingRoot: true };
    const rootRect = root.getBoundingClientRect();
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const textIssues = [];
    const textNodes = [...root.querySelectorAll('*')].filter((node) =>
      node.children.length === 0 && node.textContent?.trim() && node.getBoundingClientRect().width > 0
    );
    for (const node of textNodes) {
      const text = node.textContent.trim();
      const rect = node.getBoundingClientRect();
      let parent = node.parentElement;
      let insideHorizontalScroll = false;
      while (parent && parent !== root) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          insideHorizontalScroll = true;
          break;
        }
        parent = parent.parentElement;
      }
      const style = getComputedStyle(node);
      const horizontalClip = node.scrollWidth > node.clientWidth + 2;
      const verticalClip = node.scrollHeight > node.clientHeight + 2;
      const outsideRoot = rect.left < rootRect.left - 2 || rect.right > rootRect.right + 2;
      let clippedByAncestor = false;
      parent = node.parentElement;
      while (parent && parent !== root) {
        const parentStyle = getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        const clipsX = parentStyle.overflowX === 'hidden' || parentStyle.overflowX === 'clip';
        const clipsY = parentStyle.overflowY === 'hidden' || parentStyle.overflowY === 'clip';
        if (
          (clipsX && (rect.left < parentRect.left - 2 || rect.right > parentRect.right + 2))
          || (clipsY && (rect.top < parentRect.top - 2 || rect.bottom > parentRect.bottom + 2))
        ) {
          clippedByAncestor = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (horizontalClip || verticalClip || clippedByAncestor || (outsideRoot && !insideHorizontalScroll)) {
        textIssues.push({
          text: text.slice(0, 100),
          rect: [rect.left, rect.top, rect.right, rect.bottom],
          client: [node.clientWidth, node.clientHeight],
          scroll: [node.scrollWidth, node.scrollHeight],
          overflow: [style.overflowX, style.overflowY],
          clippedByAncestor,
          outsideRoot: outsideRoot && !insideHorizontalScroll,
        });
      }
      if (textIssues.length >= 18) break;
    }
    const tabLabels = [...document.querySelectorAll('[data-testid^="player-tab-label-"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.textContent.trim(),
        width: node.clientWidth,
        scrollWidth: node.scrollWidth,
        height: node.clientHeight,
        scrollHeight: node.scrollHeight,
        left: rect.left,
        right: rect.right,
      };
    });
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      root: [rootRect.left, rootRect.right, rootRect.top, rootRect.bottom],
      horizontalOverflow,
      textIssues,
      tabLabels,
      bodyText: document.body.innerText.slice(0, 350),
    };
  })()`);
}

async function checkReachable(selector, description, allowModalOverlay = false) {
  const state = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="player-screen"]');
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    let parent = target.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      const canScroll = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1;
      if (canScroll) {
        parent.scrollTop = parent.scrollHeight;
        break;
      }
      parent = parent.parentElement;
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect();
    const viewTop = ${allowModalOverlay ? "0" : "(rootRect?.top ?? 0)"};
    const viewBottom = ${allowModalOverlay ? "window.innerHeight" : "(rootRect?.bottom ?? window.innerHeight)"};
    const scrollParents = [];
    parent = target.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY)) {
        scrollParents.push({
          tag: parent.tagName,
          testID: parent.getAttribute('data-testid'),
          clientHeight: parent.clientHeight,
          scrollHeight: parent.scrollHeight,
          scrollTop: parent.scrollTop,
          rect: [parent.getBoundingClientRect().top, parent.getBoundingClientRect().bottom],
        });
      }
      parent = parent.parentElement;
    }
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      rootTop: rootRect?.top ?? 0,
      rootBottom: rootRect?.bottom ?? window.innerHeight,
      viewportWidth: window.innerWidth,
      viewTop,
      viewBottom,
      visibleWidth: Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)),
      visibleHeight: Math.max(0, Math.min(rect.bottom, viewBottom) - Math.max(rect.top, viewTop)),
      text: target.textContent?.trim() ?? target.getAttribute('aria-label') ?? '',
      disabled: target.disabled === true || target.getAttribute('aria-disabled') === 'true',
      scrollParents,
    };
  })()`);
  assert(state, `${description} is missing.`);
  assert(state.width > 0 && state.height > 0, `${description} has no tappable area.`);
  assert(
    state.left >= -1 && state.right <= state.viewportWidth + 1,
    `${description} extends outside the ${state.viewportWidth}px phone width.`,
  );
  assert(
    state.visibleWidth >= Math.min(state.width, 44) - 1
      && state.visibleHeight >= Math.min(state.height, 44) - 1,
    `${description} has no usable tappable area after scrolling: ${JSON.stringify(state)}.`,
  );
  return state;
}

async function assertInputReachableWithKeyboard(selector, description) {
  const state = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="player-screen"]');
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!root || !input) return null;
    input.focus();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = input.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const inputRects = [...root.querySelectorAll('input, textarea')].map((field) => {
      const bounds = field.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    });
    const overlaps = [];
    for (let first = 0; first < inputRects.length; first += 1) {
      for (let second = first + 1; second < inputRects.length; second += 1) {
        const a = inputRects[first];
        const b = inputRects[second];
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) {
          overlaps.push([first, second]);
        }
      }
    }
    return {
      focused: document.activeElement === input,
      bounds: [rect.left, rect.right, rect.top, rect.bottom],
      root: [rootRect.left, rootRect.right, rootRect.top, rootRect.bottom],
      viewport: [window.innerWidth, window.innerHeight],
      overlaps,
    };
  })()`);
  assert(state?.focused, `${description} could not receive focus with the simulated keyboard open.`);
  assert(
    state.viewport[1] === 470,
    `${description} was not tested with the simulated keyboard viewport open: ${JSON.stringify(state.viewport)}`,
  );
  assert(
    state.bounds[0] >= state.root[0] - 1
      && state.bounds[1] <= state.root[1] + 1
      && state.bounds[2] >= state.root[2] - 1
      && state.bounds[3] <= Math.min(state.root[3], state.viewport[1]) + 1
      && state.bounds[1] <= state.viewport[0] + 1
      && state.bounds[3] - state.bounds[2] >= 44,
    `${description} is not fully reachable above the simulated keyboard: ${JSON.stringify(state)}`,
  );
  assert(
    state.overlaps.length === 0,
    `${description} found overlapping form fields with the simulated keyboard open: ${JSON.stringify(state.overlaps)}`,
  );
  return state;
}

async function checkEditProfileKeyboard(viewportWidth) {
  const selectors = [
    '[data-testid="edit-profile-name"]',
    '[data-testid="edit-profile-phone"]',
    '[data-testid="edit-profile-game-uid"]',
  ];
  const expectedValues = ["Updated Preview Player", "9876543210", "1234567890"];
  for (const [index, selector] of selectors.entries()) {
    await setInputValue(selector, expectedValues[index], `Edit Profile field ${index + 1}`);
  }
  await assertInputValues(selectors, expectedValues, "before opening the simulated keyboard");

  const fullHeight = await evaluate("window.innerHeight");
  const fullScrollHeight = await evaluate(
    `document.querySelector('[data-testid="edit-profile-scroll"]')?.clientHeight ?? 0`,
  );
  const keyboardHeight = 470;
  await setPreviewViewport(viewportWidth, keyboardHeight);
  const keyboardState = await evaluate(`(() => ({
    viewportHeight: window.innerHeight,
    scrollHeight: document.querySelector('[data-testid="edit-profile-scroll"]')?.clientHeight ?? 0,
  }))()`);
  assert(
    keyboardState.viewportHeight === keyboardHeight && keyboardState.scrollHeight < fullScrollHeight,
    `The Edit Profile viewport did not shrink for the simulated keyboard: ${JSON.stringify(keyboardState)}`,
  );

  for (const [index, selector] of selectors.entries()) {
    await assertInputReachableWithKeyboard(selector, `Edit Profile field ${index + 1}`);
  }
  await assertInputValues(selectors, expectedValues, "while moving through fields with the keyboard open");

  const save = await checkReachable('[data-testid="edit-profile-save"]', "Edit Profile Save with keyboard open");
  assert(!save.disabled, "Edit Profile Save is disabled with the keyboard open.");
  await evaluate(`(() => {
    window.alert = () => {};
    const calls = window.__daily007LargestTextApiCalls;
    if (Array.isArray(calls)) calls.length = 0;
  })()`);
  await clickSelector('[data-testid="edit-profile-save"]', "Edit Profile Save with keyboard open");
  await waitForCondition(
    `window.__daily007LargestTextApiCalls?.some((call) => call.method === "updateProfile")`,
    "the keyboard-open Edit Profile save request",
  );
  const saveCalls = await evaluate(
    `window.__daily007LargestTextApiCalls?.filter((call) => call.method === "updateProfile") ?? []`,
  );
  const savedPayload = saveCalls.at(-1)?.payload;
  assert(
    savedPayload?.name === expectedValues[0]
      && savedPayload?.phone === expectedValues[1]
      && savedPayload?.gameUid === expectedValues[2],
    `Edit Profile did not submit the values entered with the keyboard open: ${JSON.stringify(savedPayload)}`,
  );

  await evaluate("document.activeElement?.blur()");
  await setPreviewViewport(viewportWidth, fullHeight);
  await assertInputValues(selectors, expectedValues, "after dismissing the keyboard");
  console.log(
    `PASS — Edit Profile at ${viewportWidth}px and 2× text; all fields and Save were reachable with the simulated keyboard open, and values remained after dismissal.`,
  );
}

async function checkScreen(screen, viewportWidth, fontScale = 2) {
  await navigateToScreen(screen.name, screen.ready, fontScale);
  if (screen.name === "Home") {
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(`/tmp/daily007-largest-text-home-${viewportWidth}.png`, Buffer.from(screenshot.data, "base64"));
  }
  const layout = await inspectLayout(screen.name);
  assert(!layout.missingRoot, `${screen.name} did not mount its screen root.`);
  assert(layout.width === viewportWidth, `${screen.name} was not rendered at ${viewportWidth}px.`);
  assert(!layout.horizontalOverflow, `${screen.name} makes the document wider than ${viewportWidth}px.`);
  assert(
    layout.textIssues.length === 0,
    `${screen.name} has text clipping or overflow: ${JSON.stringify(layout.textIssues.slice(0, 8))}`,
  );
  await checkReachable(
    screen.control,
    `${screen.name} primary control`,
    screen.name === "Leaderboard" || screen.name === "Notifications",
  );

  if (screen.name === "MyMatches") {
    await clickSelector('[data-testid="my-matches-tab-completed"]', "completed matches tab");
    await waitForCondition(
      "document.body.innerText.includes('Champion With A Long In-Game Name')",
      "completed match result",
    );
  } else if (screen.name === "Tournaments") {
    await clickSelector('[data-testid="tournament-tab-completed"]', "completed tournament tab");
    await waitForCondition(
      "document.body.innerText.includes('Daily007 International Free Fire Championship Grand Finals')",
      "completed tournament card",
    );
  } else if (screen.name === "Video") {
    await clickSelector('[data-testid="video-catalog-card-large-video-01"]', "large-text video card");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"video-open-youtube\"]'))",
      "video controls",
    );
    await checkReachable('[data-testid="video-open-youtube"]', "Open YouTube control");
  } else if (screen.name === "Wallet") {
    const refundVisible = `document.body.innerText.includes(${JSON.stringify(walletCancellationRefundDescription)})`;
    await waitForCondition(refundVisible, "cancellation refund reason in Wallet history");
    await waitForCondition("document.body.innerText.includes('+35')", "cancellation refund amount in Wallet history");
    const refundAccessibility = await evaluate(`(() => {
      const row = document.querySelector('[data-testid="wallet-cancellation-refund-row"]');
      return {
        label: row?.getAttribute('aria-label') ?? '',
      };
    })()`);
    assert(
      refundAccessibility.label.includes("Daily007 Clash Finals")
        && refundAccessibility.label.includes("tournament cancelled")
        && refundAccessibility.label.includes("+35 coins credited"),
      `Wallet cancellation refund screen-reader label is incomplete: ${JSON.stringify(refundAccessibility)}.`,
    );

    const assertSingleRefundVisible = async (when) => {
      const counts = await evaluate(`(() => {
        const text = document.body.innerText;
        const description = ${JSON.stringify(walletCancellationRefundDescription)};
        return {
          description: text.split(description).length - 1,
          amount: text.split("+35").length - 1,
        };
      })()`);
      assert(
        counts.description === 1 && counts.amount === 1,
        `Wallet must show one readable cancellation refund ${when}: ${JSON.stringify(counts)}`,
      );
    };
    await assertSingleRefundVisible("before refresh");

    await cdp("Page.reload", { ignoreCache: true });
    await waitForCondition(refundVisible, "cancellation refund reason after Wallet refresh");
    await waitForCondition("document.body.innerText.includes('+35')", "cancellation refund amount after Wallet refresh");
    await assertSingleRefundVisible("after refresh");

    await clickSelector('[data-testid="wallet-open-recharge"]', "Wallet recharge action");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"wallet-form-scroll\"]') && document.querySelector('[data-testid=\"wallet-recharge-submit\"]'))",
      "recharge form and action",
    );
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(`/tmp/daily007-largest-text-wallet-${viewportWidth}.png`, Buffer.from(screenshot.data, "base64"));
    await checkReachable('[data-testid="wallet-recharge-submit"]', "Wallet recharge submit", true);
  } else if (screen.name === "Profile") {
    await checkProfilePasswordConflictRetry();
  } else if (screen.name === "Leaderboard") {
    await waitForCondition(
      "document.body.innerText.includes('International Tournament Competitor 12')",
      "the final leaderboard row",
    );
  } else if (screen.name === "LeaderboardDetails") {
    const isLargeText = fontScale >= 1.5;
    const scaleLabel = `${fontScale}`.replace(".", "-") + "x";
    const getPodiumState = () => evaluate(`(() => ({
      text: document.querySelector('[data-testid="leaderboard-top-three"]')?.innerText ?? '',
      flexDirection: (() => {
        const podium = document.querySelector('[data-testid="leaderboard-top-three"]')?.firstElementChild;
        return podium ? getComputedStyle(podium).flexDirection : '';
      })(),
      entries: [...document.querySelectorAll('[data-testid^="leaderboard-podium-"]')].map((entry) => {
        const rect = entry.getBoundingClientRect();
        const leaves = [...entry.querySelectorAll('*')]
          .filter((node) => node.children.length === 0 && node.textContent?.trim())
          .map((node) => {
            const box = node.getBoundingClientRect();
            return { text: node.textContent.trim(), bounds: [box.left, box.right, box.top, box.bottom] };
          });
        return {
          rank: entry.getAttribute('data-testid'),
          text: entry.innerText,
          bounds: [rect.left, rect.right, rect.top, rect.bottom],
          clientHeight: entry.clientHeight,
          scrollHeight: entry.scrollHeight,
          leaves,
        };
      })
    }))()`);
    const assertPodiumGeometry = (entries, cycle) => {
      assert(entries.length === 3, `The ${cycle} podium does not show all three ranks.`);
      assert(
        entries.every((entry) => entry.scrollHeight <= entry.clientHeight + 1),
        `The ${cycle} podium clips text inside an entry at ${fontScale}× scale: ${JSON.stringify(entries)}`,
      );
      const entriesAreSeparated = entries.every((entry, index) => {
        if (index === 0) return true;
        const previous = entries[index - 1].bounds;
        return isLargeText
          ? previous[3] <= entry.bounds[2] + 1
          : previous[1] <= entry.bounds[0] + 1;
      });
      assert(
        entriesAreSeparated,
        `The ${cycle} podium entries overlap at ${fontScale}× scale: ${JSON.stringify(entries.map((entry) => entry.bounds))}`,
      );
      assert(
        entries.every((entry) => entry.leaves.every((leaf) =>
          leaf.bounds[0] >= entry.bounds[0] - 1
            && leaf.bounds[1] <= entry.bounds[1] + 1
            && leaf.bounds[2] >= entry.bounds[2] - 1
            && leaf.bounds[3] <= entry.bounds[3] + 1
        )),
        `The ${cycle} podium text escapes its entry at ${fontScale}× scale: ${JSON.stringify(entries)}`,
      );
    };
    const assertPodiumState = (podium, cycle) => {
      const champion = cycle === "weekly"
        ? "Weekly Champion With A Long Display Name"
        : "Monthly Champion With A Long Display Name";
      const expectedFlexDirection = isLargeText ? "column" : "row";
      assert(
        podium.flexDirection === expectedFlexDirection,
        `The ${cycle} podium used ${podium.flexDirection} instead of ${expectedFlexDirection} at ${fontScale}× scale.`,
      );
      assert(
        podium.text.includes(champion),
        `The ${cycle} podium champion name is missing at ${fontScale}× text: ${podium.text}`,
      );
      const expectedPodiumEntries = [
        { rank: "leaderboard-podium-1", name: champion, score: "19,269" },
        { rank: "leaderboard-podium-2", name: "Tournament Competitor 2", score: "18,538" },
        { rank: "leaderboard-podium-3", name: "Tournament Competitor 3", score: "17,807" },
      ];
      assert(
        expectedPodiumEntries.every((expected) => {
          const entry = podium.entries.find((candidate) => candidate.rank === expected.rank);
          return entry?.text.includes(expected.name) && entry.text.includes(expected.score);
        }),
        `The ${cycle} podium is missing a name or score at ${fontScale}× scale: ${JSON.stringify(podium.entries)}`,
      );
      assertPodiumGeometry(podium.entries, cycle);
    };
    const assertExpandedTopTwenty = async (cycle) => {
      const rows = await evaluate(`(() => [...document.querySelectorAll('[data-testid^="leaderboard-player-"]')].map((row) => {
        const rank = Number(row.getAttribute('data-testid').split('-').pop());
        const rect = row.getBoundingClientRect();
        return { rank, text: row.innerText, bounds: [rect.top, rect.bottom] };
      }))()`);
      assert(
        rows.length === 17,
        `The expanded ${cycle} leaderboard has ${rows.length} rows instead of ranks 4–20 at ${fontScale}× scale.`,
      );
      const missingContent = rows.filter((row, index) => {
        const rank = index + 4;
        const expectedName = rank === 4
          ? "International Tournament Competitor With A Player Name That Wraps Across Multiple Lines"
          : rank === 20
            ? "Rank Twenty Final Player"
            : `Tournament Competitor ${rank}`;
        const expectedScore = (rank === 20 ? 1_234_567 : 20_000 - rank * 731).toLocaleString("en-IN");
        return row.rank !== rank
          || !row.text.includes(`#${rank}`)
          || !row.text.includes(expectedName)
          || !row.text.includes(expectedScore)
          || !row.text.includes("🪙")
          || (isLargeText && !row.text.includes("Coins"));
      });
      assert(
        missingContent.length === 0,
        `Expanded ${cycle} rows are missing a rank, name, or score at ${fontScale}× scale: ${JSON.stringify(missingContent)}`,
      );
      assert(
        rows.every((row, index) => index === 0 || rows[index - 1].bounds[1] <= row.bounds[0] + 1),
        `Expanded ${cycle} rows overlap at ${fontScale}× scale: ${JSON.stringify(rows.map((row) => ({ rank: row.rank, bounds: row.bounds })))}`,
      );
    };
    const assertExpandedRankFour = async (cycle) => {
      const row = await evaluate(`(() => {
        const target = document.querySelector('[data-testid="leaderboard-player-4"]');
        if (!target) return null;
        const bounds = (node) => {
          const rect = node.getBoundingClientRect();
          return [rect.left, rect.right, rect.top, rect.bottom];
        };
        return {
          text: target.innerText,
          flexDirection: getComputedStyle(target).flexDirection,
          bounds: bounds(target),
          children: [...target.children].map(bounds),
        };
      })()`);
      assert(row, `The ${cycle} expanded rank-four row is missing at ${fontScale}× scale.`);
      assert(
        row.text.includes("#4")
          && row.text.includes("International Tournament Competitor With A Player Name That Wraps Across Multiple Lines")
          && row.text.includes("17,076")
          && row.text.includes("🪙")
          && (!isLargeText || row.text.includes("Coins")),
        `The ${cycle} expanded row omits its rank, full player name, or score at ${fontScale}× scale: ${row.text}`,
      );
      assert(
        row.flexDirection === (isLargeText ? "column" : "row"),
        `The ${cycle} rank-four row used ${row.flexDirection} at ${fontScale}× scale.`,
      );
      const childrenAreSeparated = isLargeText
        ? row.children.length === 2 && row.children[0][3] <= row.children[1][2] + 1
        : row.children.length >= 4
          && row.children.every((child, index) => index === 0 || row.children[index - 1][1] <= child[0] + 1);
      assert(
        childrenAreSeparated
          && row.children.every((child) =>
            child[0] >= row.bounds[0] - 1
              && child[1] <= row.bounds[1] + 1
              && child[2] >= row.bounds[2] - 1
              && child[3] <= row.bounds[3] + 1
          ),
        `The ${cycle} rank, name, and score overlap or escape the row at ${fontScale}× scale: ${JSON.stringify(row)}`,
      );
      const hasColumnHeader = await evaluate("document.body.innerText.includes('RANK')");
      assert(
        hasColumnHeader === !isLargeText,
        `The ${cycle} Top 20 row header did not match the ${fontScale}× layout: ${hasColumnHeader}`,
      );
    };
    const weeklyPodium = await getPodiumState();
    assertPodiumState(weeklyPodium, "weekly");
    const weeklyScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `/tmp/daily007-weekly-leaderboard-podium-${scaleLabel}.png`,
      Buffer.from(weeklyScreenshot.data, "base64"),
    );

    await clickSelector('[data-testid="leaderboard-top20-toggle"]', "weekly Top 20 toggle");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"leaderboard-player-20\"]'))",
      "expanded weekly ranks through 20",
    );
    const weeklyExpanded = await inspectLayout(screen.name);
    assert(
      weeklyExpanded.textIssues.length === 0,
      `The weekly expanded leaderboard clips text at ${fontScale}× scale: ${JSON.stringify(weeklyExpanded.textIssues.slice(0, 8))}`,
    );
    await assertExpandedTopTwenty("weekly");
    await assertExpandedRankFour("weekly");
    await checkReachable('[data-testid="leaderboard-player-4"]', "expanded weekly rank-four row");
    const expandedRowScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `/tmp/daily007-weekly-leaderboard-expanded-row-${scaleLabel}.png`,
      Buffer.from(expandedRowScreenshot.data, "base64"),
    );

    const checkRankTwentyReachable = async (cycle) => {
      const state = await evaluate(`(() => {
        const target = document.querySelector('[data-testid="leaderboard-player-20"]');
        if (!target) return null;
        let parent = target.parentElement;
        let scroll = null;
        while (parent && parent !== document.body) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
            scroll = parent;
            break;
          }
          parent = parent.parentElement;
        }
        if (!scroll) return { missingScroll: true };
        scroll.scrollTop = scroll.scrollHeight;
        target.scrollIntoView({ block: 'end', inline: 'nearest' });
        const row = target.getBoundingClientRect();
        const viewport = scroll.getBoundingClientRect();
        return {
          scrollTop: scroll.scrollTop,
          rowText: target.innerText,
          row: [row.top, row.bottom],
          viewport: [viewport.top, viewport.bottom],
        };
      })()`);
      assert(
        state && !state.missingScroll && state.scrollTop > 0,
        `The ${cycle} leaderboard did not scroll at ${fontScale}× scale.`,
      );
      assert(
        state.row[0] >= state.viewport[0] - 1 && state.row[1] <= state.viewport[1] + 1,
        `Rank 20 is not reachable in the ${cycle} leaderboard at ${fontScale}× scale: ${JSON.stringify(state)}`,
      );
      assert(
        state.rowText.includes("#20")
          && state.rowText.includes("Rank Twenty Final Player")
          && state.rowText.includes("12,34,567")
          && state.rowText.includes("🪙")
          && (!isLargeText || state.rowText.includes("Coins")),
        `Rank 20 is missing its readable rank, name, or score for ${cycle} at ${fontScale}× scale: ${state.rowText}`,
      );
    };
    await checkRankTwentyReachable("weekly");

    await clickSelector('[data-testid="leaderboard-details-tab-monthly"]', "monthly leaderboard tab");
    await waitForCondition(
      "document.querySelector('[data-testid=\"leaderboard-rewards-monthly\"]') && document.body.innerText.includes('Monthly Champion With A Long Display Name')",
      "monthly prizes and podium",
    );
    await evaluate(`(() => {
      const scroller = document.querySelector('[data-testid="leaderboard-details-scroll"]');
      if (scroller) scroller.scrollTop = 0;
    })()`);
    const monthlyToggle = await evaluate(
      `document.querySelector('[data-testid="leaderboard-top20-toggle"]')?.innerText ?? ''`,
    );
    assert(
      monthlyToggle.includes("VIEW TOP 20 PLAYERS"),
      `Switching to monthly did not collapse its expanded rows: ${monthlyToggle}`,
    );
    const monthlyPodium = await getPodiumState();
    assertPodiumState(monthlyPodium, "monthly");
    const monthlyScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `/tmp/daily007-monthly-leaderboard-podium-${scaleLabel}.png`,
      Buffer.from(monthlyScreenshot.data, "base64"),
    );
    const monthlyLayout = await inspectLayout(screen.name);
    assert(
      monthlyLayout.textIssues.length === 0,
      `The monthly podium clips text at ${fontScale}× scale: ${JSON.stringify(monthlyLayout.textIssues.slice(0, 8))}`,
    );

    await clickSelector('[data-testid="leaderboard-top20-toggle"]', "monthly Top 20 toggle");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"leaderboard-player-20\"]'))",
      "expanded monthly ranks through 20",
    );
    const monthlyExpanded = await inspectLayout(screen.name);
    assert(
      monthlyExpanded.textIssues.length === 0,
      `The monthly expanded leaderboard clips text at ${fontScale}× scale: ${JSON.stringify(monthlyExpanded.textIssues.slice(0, 8))}`,
    );
    await assertExpandedTopTwenty("monthly");
    await assertExpandedRankFour("monthly");
    await checkRankTwentyReachable("monthly");
  } else if (screen.name === "Notifications") {
    await waitForCondition(
      "document.body.innerText.includes('Your prize coins were added to your wallet')",
      "the later notification",
    );
  } else if (screen.name === "EditProfile") {
    await checkReachable('[data-testid="edit-profile-save"]', "Edit Profile save action");
    await checkEditProfileKeyboard(viewportWidth);
  } else if (screen.name === "JoinForm") {
    await setInputValue(
      'input[placeholder="Captain Free Fire in-game name"]',
      "Test Captain",
      "captain game name",
    );
    await setInputValue(
      'input[placeholder="Captain Free Fire UID"]',
      "FF-TEST-PLAYER",
      "captain game UID",
    );
    const joinInputs = [
      'input[placeholder="Captain Free Fire in-game name"]',
      'input[placeholder="Captain Free Fire UID"]',
    ];
    const joinValues = ["Test Captain", "FF-TEST-PLAYER"];
    const fullHeight = await evaluate("window.innerHeight");
    const keyboardHeight = 470;
    await setPreviewViewport(viewportWidth, keyboardHeight);
    for (const [index, selector] of joinInputs.entries()) {
      await assertInputReachableWithKeyboard(selector, `Join Form field ${index + 1}`);
    }
    await assertInputValues(joinInputs, joinValues, "while moving through Join Form fields with the keyboard open");
    const submit = await checkReachable('[data-testid="join-form-submit"]', "Join Form Submit with keyboard open");
    assert(!submit.disabled, "Join Form Submit is disabled with the keyboard open.");
    await evaluate("window.alert = () => {}");
    await clickSelector('[data-testid="join-form-submit"]', "join form submit action");
    await waitForCondition(
      "document.body.innerText.includes('Insufficient wallet balance: this entry costs 7 coins.')",
      "server join error",
    );
    await assertInputValues(joinInputs, joinValues, "after submitting with the keyboard open");
    const joinText = await evaluate("document.body.innerText");
    assert(
      !joinText.includes("Registration confirmed") && !joinText.includes("Your slot is confirmed"),
      "A rejected join displayed a success confirmation.",
    );
    await evaluate("document.activeElement?.blur()");
    await setPreviewViewport(viewportWidth, fullHeight);
    await assertInputValues(joinInputs, joinValues, "after dismissing the keyboard");
  }

  console.log(`PASS — ${screen.name} at ${viewportWidth}px and ${fontScale}× Android text scale.`);
}

async function checkUnavailableVideoRewardFlow() {
  await navigateToScreen("VideoUnavailable", "Tutorial Videos");
  await clickSelector('[data-testid="video-catalog-card-unavailable-video"]', "unavailable test video");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "video playback start");
  await waitForCondition(
    "window.__videoRewardPreviewCalls?.starts.length === 1",
    "server video-watch start request",
  );
  const startedWith = await evaluate("window.__videoRewardPreviewCalls.starts[0]");
  assert(
    startedWith?.data?.videoId === "unavailable-video" && startedWith.data.durationSeconds === 8,
    `Playback did not start for the unavailable catalog item: ${JSON.stringify(startedWith)}`,
  );
  await clickSelector('[data-testid="video-preview-finish-playback"]', "video completion simulator");
  await waitForCondition(
    "document.body.innerText.includes('This video is no longer available for rewards.')",
    "unavailable-video completion message",
  );
  const unavailableState = await evaluate(`(() => ({
    retry: [...document.querySelectorAll('button')]
      .some((button) => button.innerText.includes('RETRY COIN CLAIM')),
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
  }))()`);
  assert(
    !unavailableState.retry && unavailableState.completions === 1,
    `Unavailable video offered a stale retry or skipped its completion request: ${JSON.stringify(unavailableState)}`,
  );

  await clickSelector('[data-testid="video-catalog-back"]', "return to video catalog");
  await waitForCondition(
    `document.body.innerText.includes('Preview video that remains available')
      && !document.body.innerText.includes('Preview video that becomes unavailable')`,
    "refreshed video catalog without the unavailable item",
  );
  const refreshedCatalog = await evaluate(`(() => ({
    remainingCard: document.querySelector('[data-testid="video-catalog-card-still-active-video"]') !== null,
    unavailableCard: document.querySelector('[data-testid="video-catalog-card-unavailable-video"]') !== null,
    refreshes: window.__videoRewardPreviewCalls?.listRefetches ?? 0,
  }))()`);
  assert(
    refreshedCatalog.remainingCard && !refreshedCatalog.unavailableCard && refreshedCatalog.refreshes === 1,
    `The catalog did not refresh to the remaining active video: ${JSON.stringify(refreshedCatalog)}`,
  );
  console.log("PASS — unavailable video completion shows no retry and refreshes the catalog.");
}

async function checkUnavailableVideoCatalogRefreshFailure() {
  const unavailableMessage = "This video is no longer available for rewards.";
  const catalogError = "Could not load videos. Check your connection and try again.";
  const searchQuery = "Preview video";
  await navigateToScreen("VideoRefreshFailure", "Tutorial Videos");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-catalog-search\"]'))",
    "video catalog search before filtering",
  );
  await setInputValue('[data-testid="video-catalog-search"]', searchQuery, "the shared video title filter");
  await waitForCondition(
    `document.querySelector('[data-testid="video-catalog-search"]')?.value === ${JSON.stringify(searchQuery)}
      && Boolean(document.querySelector('[data-testid="video-catalog-card-unavailable-video"]'))
      && Boolean(document.querySelector('[data-testid="video-catalog-card-still-active-video"]'))`,
    "both preview videos matching the search filter",
  );
  const filteredCatalog = await evaluate(`(() => ({
    searchValue: document.querySelector('[data-testid="video-catalog-search"]')?.value ?? null,
    unavailableCard: document.querySelector('[data-testid="video-catalog-card-unavailable-video"]') !== null,
    activeCard: document.querySelector('[data-testid="video-catalog-card-still-active-video"]') !== null,
  }))()`);
  assert(
    filteredCatalog.searchValue === searchQuery
      && filteredCatalog.unavailableCard
      && filteredCatalog.activeCard,
    `The search should match both videos before opening the unavailable one: ${JSON.stringify(filteredCatalog)}`,
  );
  await clickSelector('[data-testid="video-catalog-card-unavailable-video"]', "video that becomes unavailable");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator before unavailable-video completion",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "unavailable-video playback start");
  await waitForCondition(
    "window.__videoRewardPreviewCalls?.starts.length === 1",
    "watch session for the unavailable-video flow",
  );
  await clickSelector('[data-testid="video-preview-finish-playback"]', "complete the now-unavailable video");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(unavailableMessage)})`,
    "unavailable-video completion response",
  );
  await clickSelector('[data-testid="video-catalog-back"]', "return to the catalog after unavailable completion");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(catalogError)})
      && Boolean(document.querySelector('[data-testid="video-catalog-reload"]'))`,
    "catalog refresh error and reload action",
  );

  const failedRefresh = await evaluate(`(() => ({
    errorVisible: document.body.innerText.includes(${JSON.stringify(catalogError)}),
    reloadVisible: document.querySelector('[data-testid="video-catalog-reload"]') !== null,
    unavailableCard: document.querySelector('[data-testid="video-catalog-card-unavailable-video"]') !== null,
    activeCard: document.querySelector('[data-testid="video-catalog-card-still-active-video"]') !== null,
    refreshes: window.__videoRewardPreviewCalls?.listRefetches ?? 0,
  }))()`);
  assert(
    failedRefresh.errorVisible
      && failedRefresh.reloadVisible
      && !failedRefresh.unavailableCard
      && !failedRefresh.activeCard
      && failedRefresh.refreshes === 1,
    `A failed catalog refresh should show recovery instead of the stale list: ${JSON.stringify(failedRefresh)}`,
  );

  await clickSelector('[data-testid="video-catalog-reload"]', "retry video catalog refresh");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(catalogError)})
      && Boolean(document.querySelector('[data-testid="video-catalog-reload"]'))
      && window.__videoRewardPreviewCalls?.listRefetches === 2`,
    "catalog error and reload action after the second consecutive refresh failure",
  );
  const repeatedFailure = await evaluate(`(() => ({
    errorVisible: document.body.innerText.includes(${JSON.stringify(catalogError)}),
    reloadVisible: document.querySelector('[data-testid="video-catalog-reload"]') !== null,
    unavailableCard: document.querySelector('[data-testid="video-catalog-card-unavailable-video"]') !== null,
    activeCard: document.querySelector('[data-testid="video-catalog-card-still-active-video"]') !== null,
    refreshes: window.__videoRewardPreviewCalls?.listRefetches ?? 0,
  }))()`);
  assert(
    repeatedFailure.errorVisible
      && repeatedFailure.reloadVisible
      && !repeatedFailure.unavailableCard
      && !repeatedFailure.activeCard
      && repeatedFailure.refreshes === 2,
    `A second failed refresh should keep recovery available and hide stale catalog entries: ${JSON.stringify(repeatedFailure)}`,
  );

  await clickSelector('[data-testid="video-catalog-reload"]', "retry video catalog refresh after the second failure");
  await waitForCondition(
    `document.body.innerText.includes('Preview video that remains available')
      && !document.body.innerText.includes('Preview video that becomes unavailable')
      && !document.body.innerText.includes(${JSON.stringify(catalogError)})
      && window.__videoRewardPreviewCalls?.listRefetches === 3`,
    "refreshed catalog after the third attempt succeeds",
  );
  const recoveredCatalog = await evaluate(`(() => ({
    errorVisible: document.body.innerText.includes(${JSON.stringify(catalogError)}),
    unavailableCard: document.querySelector('[data-testid="video-catalog-card-unavailable-video"]') !== null,
    activeCard: document.querySelector('[data-testid="video-catalog-card-still-active-video"]') !== null,
    searchValue: document.querySelector('[data-testid="video-catalog-search"]')?.value ?? null,
    oneFilteredResult: document.body.innerText.includes("Tutorial Videos (1)"),
    refreshes: window.__videoRewardPreviewCalls?.listRefetches ?? 0,
  }))()`);
  assert(
    !recoveredCatalog.errorVisible
      && !recoveredCatalog.unavailableCard
      && recoveredCatalog.activeCard
      && recoveredCatalog.searchValue === searchQuery
      && recoveredCatalog.oneFilteredResult
      && recoveredCatalog.refreshes === 3,
    `Retrying the catalog should preserve the search and show its remaining active result: ${JSON.stringify(recoveredCatalog)}`,
  );
  console.log("PASS — catalog reload stays available across two failures, preserves search, and recovers on the third attempt.");
}

async function checkTransientVideoRewardRetry() {
  await navigateToScreen("VideoTransient", "Tutorial Videos");
  await clickSelector('[data-testid="video-catalog-card-unavailable-video"]', "transient-failure test video");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator for transient failure",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "transient test playback start");
  await waitForCondition(
    "window.__videoRewardPreviewCalls?.starts.length === 1",
    "transient test video-watch start request",
  );
  await clickSelector('[data-testid="video-preview-finish-playback"]', "transient test completion");
  await waitForCondition(
    `document.body.innerText.includes('Temporary completion network failure.')
      && [...document.querySelectorAll('button')]
        .some((button) => button.innerText.includes('RETRY COIN CLAIM'))`,
    "retry action after a transient completion failure",
  );
  await clickButtonWithText("RETRY COIN CLAIM", "retry coin claim action");
  await waitForCondition(
    `document.body.innerText.includes('1 coin added to your wallet.')
      && ![...document.querySelectorAll('button')]
        .some((button) => button.innerText.includes('RETRY COIN CLAIM'))`,
    "successful retry after the transient failure",
  );
  const retryAttempts = await evaluate("window.__videoRewardPreviewCalls?.completions.length ?? 0");
  assert(retryAttempts === 2, `Retry did not issue a second completion request: ${retryAttempts}`);
  console.log("PASS — transient completion failures still offer a working retry.");
}

async function checkLateVideoRewardCompletion() {
  const oldVideoError = "Late completion failed for the previous video.";
  const currentVideoError = "Temporary current-video completion failure.";
  await navigateToScreen("VideoLateCompletion", "Tutorial Videos");
  await clickSelector(
    '[data-testid="video-catalog-card-still-active-video"]',
    "first video for the delayed completion test",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "player for the first video",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "start the first video");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 1
      && window.__videoRewardPreviewCalls?.sessions.length === 1`,
    "first video watch session",
  );
  await clickSelector('[data-testid="video-preview-finish-playback"]', "finish the first video");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.completions.length === 1
      && typeof window.__rejectPendingVideoRewardCompletion === "function"`,
    "held reward completion for the first video",
  );
  const pendingOldCompletion = await evaluate(`(() => ({
    verifying: document.body.innerText.includes("Verifying the completed view…"),
    errorVisible: document.querySelector('[data-testid="video-watch-error"]') !== null,
    retryClaim: [...document.querySelectorAll('button')]
      .some((button) => button.innerText.includes("RETRY COIN CLAIM")),
  }))()`);
  assert(
    pendingOldCompletion.verifying && !pendingOldCompletion.errorVisible && !pendingOldCompletion.retryClaim,
    `The first completion should remain pending without an error or claim retry: ${JSON.stringify(pendingOldCompletion)}`,
  );

  await clickSelector('[data-testid="video-catalog-back"]', "leave the first video");
  await clickSelector(
    '[data-testid="video-catalog-card-unavailable-video"]',
    "open a different video while the first completion is pending",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "player for the new video",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "start the new video");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 2
      && window.__videoRewardPreviewCalls?.sessions.length === 2`,
    "new video watch session",
  );

  await evaluate("window.__rejectPendingVideoRewardCompletion?.()");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.lateCompletionRejections === 1
      && typeof window.__rejectPendingVideoRewardCompletion !== "function"`,
    "late rejection from the first video",
  );
  await evaluate("new Promise((resolve) => setTimeout(resolve, 0))");
  const newVideoAfterOldRejection = await evaluate(`(() => ({
    titleVisible: document.body.innerText.includes("Preview video that becomes unavailable"),
    oldErrorVisible: document.body.innerText.includes(${JSON.stringify(oldVideoError)}),
    errorVisible: document.querySelector('[data-testid="video-watch-error"]') !== null,
    retryClaim: [...document.querySelectorAll('button')]
      .some((button) => button.innerText.includes("RETRY COIN CLAIM")),
    verifying: document.body.innerText.includes("Verifying the completed view…"),
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
  }))()`);
  assert(
    newVideoAfterOldRejection.titleVisible
      && !newVideoAfterOldRejection.oldErrorVisible
      && !newVideoAfterOldRejection.errorVisible
      && !newVideoAfterOldRejection.retryClaim
      && !newVideoAfterOldRejection.verifying
      && newVideoAfterOldRejection.completions === 1,
    `A late rejection must not affect the new video or expose a stale retry: ${JSON.stringify(newVideoAfterOldRejection)}`,
  );

  await clickSelector('[data-testid="video-preview-finish-playback"]', "finish the new video");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(currentVideoError)})
      && [...document.querySelectorAll('button')]
        .some((button) => button.innerText.includes("RETRY COIN CLAIM"))`,
    "retry after the new video's own completion failure",
  );
  const currentVideoFailure = await evaluate(`(() => ({
    completions: window.__videoRewardPreviewCalls?.completions ?? [],
    currentErrorVisible: document.body.innerText.includes(${JSON.stringify(currentVideoError)}),
    oldErrorVisible: document.body.innerText.includes(${JSON.stringify(oldVideoError)}),
    retryClaim: [...document.querySelectorAll('button')]
      .some((button) => button.innerText.includes("RETRY COIN CLAIM")),
  }))()`);
  assert(
    currentVideoFailure.completions.length === 2
      && currentVideoFailure.completions[1]?.data?.sessionId === "preview-video-watch-session-2"
      && currentVideoFailure.currentErrorVisible
      && !currentVideoFailure.oldErrorVisible
      && currentVideoFailure.retryClaim,
    `A failure from the new video's own session should still offer its retry: ${JSON.stringify(currentVideoFailure)}`,
  );

  await clickButtonWithText("RETRY COIN CLAIM", "retry completion for the new video");
  await waitForCondition(
    `document.body.innerText.includes("1 coin added to your wallet.")
      && ![...document.querySelectorAll('button')]
        .some((button) => button.innerText.includes("RETRY COIN CLAIM"))`,
    "successful retry for the new video's own completion",
  );
  const completedRetry = await evaluate(`(() => ({
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions ?? [],
    retryClaim: [...document.querySelectorAll('button')]
      .some((button) => button.innerText.includes("RETRY COIN CLAIM")),
  }))()`);
  assert(
    completedRetry.sessions.length === 2
      && completedRetry.completions.length === 3
      && completedRetry.completions[1]?.data?.sessionId === "preview-video-watch-session-2"
      && completedRetry.completions[2]?.data?.sessionId === "preview-video-watch-session-2"
      && !completedRetry.retryClaim,
    `Retry must use the new video's own session and clear on success: ${JSON.stringify(completedRetry)}`,
  );
  console.log("PASS — late completion rejection cannot create a retry on a new video, and the new video's own retry works.");
}

async function checkVideoWatchStartFailure() {
  const startFailureMessage = "The video watch session could not be created.";
  await navigateToScreen("VideoStartFailure", "Tutorial Videos");
  await clickSelector(
    '[data-testid="video-catalog-card-still-active-video"]',
    "active video for the watch-session start failure test",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator after opening an active video",
  );
  const startControlFocused = await evaluate(`(() => {
    const control = document.querySelector('[data-testid="video-preview-start-playback"]');
    control?.focus();
    return Boolean(control && document.activeElement === control);
  })()`);
  assert(startControlFocused, "The playback-start control should be focusable before the session fails.");
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "playback start before session creation");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 1
      && document.body.innerText.includes(${JSON.stringify(startFailureMessage)})`,
    "visible video-watch session creation failure",
  );
  const failedStart = await evaluate(`(() => ({
    errorVisible: document.body.innerText.includes(${JSON.stringify(startFailureMessage)}),
    starts: window.__videoRewardPreviewCalls?.starts.length ?? 0,
    firstStart: window.__videoRewardPreviewCalls?.starts[0],
    sessions: window.__videoRewardPreviewCalls?.sessions.length ?? 0,
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
    liveRegion: document.querySelector('[data-testid="video-watch-error-message"]')?.getAttribute('aria-live') ?? null,
    liveRegionCount: document.querySelectorAll('[data-testid="video-watch-error-message"][aria-live="polite"]').length,
    errorFocused: (() => {
      const error = document.querySelector('[data-testid="video-watch-error"]');
      return Boolean(error && (document.activeElement === error || error.contains(document.activeElement)));
    })(),
    focusStayedOnStart:
      document.activeElement === document.querySelector('[data-testid="video-preview-start-playback"]'),
    focusableLiveRegions: [...document.querySelectorAll('[data-testid="video-watch-error-message"]')]
      .filter((error) => error.matches('button, a[href], input, [tabindex="0"]')).length,
  }))()`);
  assert(
    failedStart.errorVisible
      && failedStart.starts === 1
      && failedStart.firstStart?.data?.videoId === "still-active-video"
      && failedStart.sessions === 0
      && failedStart.completions === 0
      && !failedStart.retryClaim,
    `A failed session start must show its error without a session, completion, or claim retry: ${JSON.stringify(failedStart)}`,
  );
  assert(
    failedStart.liveRegion === "polite"
      && failedStart.liveRegionCount === 1
      && !failedStart.errorFocused
      && failedStart.focusStayedOnStart
      && failedStart.focusableLiveRegions === 0,
    `The session-start error should announce politely without moving or trapping focus: ${JSON.stringify(failedStart)}`,
  );

  await clickSelector('[data-testid="video-preview-finish-playback"]', "finish playback without a watch session");
  const endedPlayback = await evaluate(`(() => ({
    errorVisible: document.body.innerText.includes(${JSON.stringify(startFailureMessage)}),
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
  }))()`);
  assert(
    endedPlayback.errorVisible && endedPlayback.completions === 0 && !endedPlayback.retryClaim,
    `Finishing unverified playback must not offer a completion or claim retry: ${JSON.stringify(endedPlayback)}`,
  );

  await clickSelector('[data-testid="video-catalog-back"]', "return to the video catalog after start failure");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-catalog-card-still-active-video\"]'))",
    "active video card after returning to the catalog",
  );
  await clickSelector(
    '[data-testid="video-catalog-card-still-active-video"]',
    "restart the active video from the catalog",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "fresh video playback simulator",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "fresh playback start");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 2
      && window.__videoRewardPreviewCalls?.sessions.length === 1`,
    "fresh server watch session after returning to the catalog",
  );

  const restartedPlayback = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts ?? [],
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    errorVisible: document.body.innerText.includes(${JSON.stringify(startFailureMessage)}),
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
  }))()`);
  assert(
    restartedPlayback.starts.length === 2
      && restartedPlayback.starts[1]?.data?.videoId === "still-active-video"
      && restartedPlayback.sessions.length === 1
      && restartedPlayback.sessions[0] === "preview-video-watch-session-2"
      && restartedPlayback.completions === 0
      && !restartedPlayback.errorVisible
      && !restartedPlayback.retryClaim,
    `Returning to the catalog should allow a fresh session without reusing the failed attempt: ${JSON.stringify(restartedPlayback)}`,
  );
  console.log("PASS — failed watch-session creation offers no reward claim and allows a fresh start.");
}

async function checkDelayedVideoWatchStart() {
  await navigateToScreen("VideoDelayedStart", "Tutorial Videos");
  await clickSelector(
    '[data-testid="video-catalog-card-still-active-video"]',
    "active video for the delayed watch-session test",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator before a delayed session start",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "start playback with a pending session request");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 1
      && typeof window.__resolvePendingVideoWatchStart === "function"`,
    "pending video-watch session request",
  );

  const pendingStart = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts.length ?? 0,
    sessions: window.__videoRewardPreviewCalls?.sessions.length ?? 0,
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
  }))()`);
  assert(
    pendingStart.starts === 1
      && pendingStart.sessions === 0
      && pendingStart.completions === 0
      && !pendingStart.retryClaim,
    `The initial playback should wait for its session without claiming a reward: ${JSON.stringify(pendingStart)}`,
  );

  await clickSelector('[data-testid="video-preview-finish-playback"]', "end playback before the session request resolves");
  const endedPlayback = await evaluate(`(() => ({
    sessions: window.__videoRewardPreviewCalls?.sessions.length ?? 0,
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
  }))()`);
  assert(
    endedPlayback.sessions === 0 && endedPlayback.completions === 0 && !endedPlayback.retryClaim,
    `Ending playback with a pending session must not complete or expose a claim retry: ${JSON.stringify(endedPlayback)}`,
  );

  await evaluate("window.__resolvePendingVideoWatchStart?.()");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.sessions.length === 1
      && typeof window.__resolvePendingVideoWatchStart !== "function"`,
    "late server response for the ended playback",
  );
  const lateReply = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts.length ?? 0,
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions.length ?? 0,
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
    errorVisible: document.querySelector('[data-testid="video-watch-error"]') !== null,
  }))()`);
  assert(
    lateReply.starts === 1
      && lateReply.sessions[0] === "preview-video-watch-session-1"
      && lateReply.completions === 0
      && !lateReply.retryClaim
      && !lateReply.errorVisible,
    `A late session reply must not affect the finished playback or offer a claim retry: ${JSON.stringify(lateReply)}`,
  );

  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector('[data-testid="video-preview-start-playback"]', "start a fresh playback after the delayed reply");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 2
      && window.__videoRewardPreviewCalls?.sessions.length === 2`,
    "fresh server watch session for the later playback",
  );
  await clickSelector('[data-testid="video-preview-finish-playback"]', "complete the later playback");
  await waitForCondition(
    `document.body.innerText.includes("1 coin added to your wallet.")
      && window.__videoRewardPreviewCalls?.completions.length === 1`,
    "reward completion from the later playback",
  );
  const freshPlayback = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts ?? [],
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions ?? [],
    retryClaim: document.querySelector('[data-testid="video-retry-claim"]') !== null,
  }))()`);
  assert(
    freshPlayback.starts.length === 2
      && freshPlayback.sessions[0] === "preview-video-watch-session-1"
      && freshPlayback.sessions[1] === "preview-video-watch-session-2"
      && freshPlayback.completions.length === 1
      && freshPlayback.completions[0]?.data?.sessionId === "preview-video-watch-session-2"
      && !freshPlayback.retryClaim,
    `A later playback must claim only with its own fresh session: ${JSON.stringify(freshPlayback)}`,
  );
  console.log("PASS — a late session reply cannot reward ended playback, and a fresh playback uses its own session.");
}

async function checkRepeatedProgressWhileVideoWatchStartPending() {
  await navigateToScreen("VideoDelayedStart", "Tutorial Videos");
  await clickSelector(
    '[data-testid="video-catalog-card-still-active-video"]',
    "active video for repeated progress during a pending watch-session start",
  );
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"video-preview-start-playback\"]'))",
    "video playback simulator before repeated pending-start progress",
  );
  await evaluate(`(() => {
    window.__daily007VideoNow = performance.timeOrigin + performance.now();
    Date.now = () => window.__daily007VideoNow;
  })()`);
  await clickSelector(
    '[data-testid="video-preview-start-playback"]',
    "start playback with a pending server session",
  );
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.starts.length === 1
      && typeof window.__resolvePendingVideoWatchStart === "function"`,
    "the first pending video-watch session request",
  );

  const sentProgressCount = await evaluate(`(() => {
    const sendProgress = window.__sendVideoRewardPreviewProgress;
    if (typeof sendProgress !== "function") {
      throw new Error("The preview progress sender is unavailable.");
    }
    for (const currentTime of [0.25, 0.5, 0.75]) {
      window.__daily007VideoNow += 1_000;
      sendProgress(currentTime, 8);
    }
    return 3;
  })()`);
  assert(sentProgressCount === 3, "three progress updates must be sent while session creation is pending.");
  const pendingProgress = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts.length ?? 0,
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions ?? [],
  }))()`);
  assert(
    pendingProgress.starts === 1
      && pendingProgress.sessions.length === 0
      && pendingProgress.completions.length === 0,
    `Repeated progress must not issue another start or complete an unstarted session: ${JSON.stringify(pendingProgress)}`,
  );

  await evaluate("window.__resolvePendingVideoWatchStart?.()");
  await waitForCondition(
    `window.__videoRewardPreviewCalls?.sessions.length === 1
      && typeof window.__resolvePendingVideoWatchStart !== "function"`,
    "the one resolved server watch session",
  );
  await clickSelector(
    '[data-testid="video-preview-finish-playback"]',
    "complete the playback after its start request resolves",
  );
  await waitForCondition(
    `document.body.innerText.includes("1 coin added to your wallet.")
      && window.__videoRewardPreviewCalls?.completions.length === 1`,
    "completion using the resolved watch session",
  );
  const completedPlayback = await evaluate(`(() => ({
    starts: window.__videoRewardPreviewCalls?.starts ?? [],
    sessions: window.__videoRewardPreviewCalls?.sessions ?? [],
    completions: window.__videoRewardPreviewCalls?.completions ?? [],
  }))()`);
  assert(
    completedPlayback.starts.length === 1
      && completedPlayback.sessions.length === 1
      && completedPlayback.sessions[0] === "preview-video-watch-session-1"
      && completedPlayback.completions.length === 1
      && completedPlayback.completions[0]?.data?.sessionId === completedPlayback.sessions[0]
      && completedPlayback.completions[0]?.data?.percentWatched >= 75,
    `The completed playback must use exactly its one pending-start session: ${JSON.stringify(completedPlayback)}`,
  );
  console.log("PASS — repeated progress during a pending start creates one session, and completion uses that session.");
}

async function checkProfilePasswordConflictRetry() {
  const conflictMessage = "The password changed in another session. Sign in again and retry.";
  const successMessage = "Password changed. Other sessions stay active until the next sign-in.";
  const currentSelector = 'input[aria-label="Current Daily007 password"]';
  const newSelector = 'input[aria-label="New Daily007 password"]';
  const confirmSelector = 'input[placeholder="Confirm new password"]';

  await clickSelector('[data-testid="profile-change-password"]', "Profile change password action");
  await waitForCondition(
    "Boolean(document.querySelector('[data-testid=\"profile-password-submit\"]'))",
    "password-change dialog",
  );
  await checkReachable('[data-testid="profile-password-submit"]', "Profile password submit", true);
  await setInputValue(currentSelector, "wrong-current-password", "the current password");
  await setInputValue(newSelector, "replacement-password", "the new password");
  await setInputValue(confirmSelector, "replacement-password", "the confirmation password");
  await evaluate(`document.querySelector('[data-testid="profile-password-submit"]')?.focus()`);
  const focusedControlBeforeConflict = await evaluate(
    "document.activeElement?.getAttribute('data-testid') ?? null",
  );
  await clickSelector('[data-testid="profile-password-submit"]', "Profile password submit");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(conflictMessage)})`,
    "password-change conflict message",
  );

  const afterConflict = await evaluate(`(() => ({
    messageVisible: document.body.innerText.includes(${JSON.stringify(conflictMessage)}),
    announcements: [...document.querySelectorAll('[aria-live]')]
      .filter((node) => node.textContent?.trim() === ${JSON.stringify(conflictMessage)})
      .map((node) => node.getAttribute('aria-live')),
    focusedControl: document.activeElement?.getAttribute('data-testid') ?? null,
    currentPassword: document.querySelector(${JSON.stringify(currentSelector)})?.value ?? null,
    newPassword: document.querySelector(${JSON.stringify(newSelector)})?.value ?? null,
    confirmPassword: document.querySelector(${JSON.stringify(confirmSelector)})?.value ?? null,
    requests: window.__daily007PasswordChangePreview?.requests ?? [],
  }))()`);
  assert(afterConflict.messageVisible, "The password-change conflict must be visible in the Profile dialog.");
  assert(
    JSON.stringify(afterConflict.announcements) === JSON.stringify(["polite"]),
    "The conflict should have one polite live-region announcement, not a duplicate or interrupting announcement.",
  );
  assert(
    afterConflict.focusedControl === focusedControlBeforeConflict,
    "Announcing the conflict must not move focus away from the password submit control.",
  );
  assert(
    JSON.stringify({
      currentPassword: afterConflict.currentPassword,
      newPassword: afterConflict.newPassword,
      confirmPassword: afterConflict.confirmPassword,
    }) === JSON.stringify({
      currentPassword: "wrong-current-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }),
    "the dialog must preserve all entered values after the conflict",
  );
  assert(afterConflict.requests.length === 1, "the conflict should come from the first submitted request.");

  await setInputValue(currentSelector, "correct-current-password", "the corrected current password");
  await clickSelector('[data-testid="profile-password-submit"]', "Profile password retry");
  await waitForCondition(
    `document.body.innerText.includes(${JSON.stringify(successMessage)})`,
    "successful password-change retry",
  );

  const requests = await evaluate("window.__daily007PasswordChangePreview?.requests ?? []");
  assert(requests.length === 2, "the corrected form should submit a second request.");
  assert(
    JSON.stringify(requests[1]) === JSON.stringify({
      currentPassword: "correct-current-password",
      newPassword: "replacement-password",
    }),
    "the retry should submit the corrected current password and retained new password.",
  );
  console.log("PASS — password conflicts preserve the form and allow a successful retry.");
}

try {
  vitePort = await getFreePort();
  const debugPort = await getFreePort();
  temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-largest-text-"));
  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@workspace/mockup-sandbox",
      "exec",
      "vite",
      "--force",
      "--config",
      "vite.player-largest-text.config.ts",
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
    `http://127.0.0.1:${vitePort}/player-largest-text-preview.html`,
    "Largest-text Vite preview",
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
      `http://127.0.0.1:${vitePort}/player-largest-text-preview.html?screen=Home`,
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
  const leaderboardDetailsScreen = screens.find((screen) => screen.name === "LeaderboardDetails");
  assert(leaderboardDetailsScreen, "The leaderboard-details preview is not registered.");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 820,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(120);
  if (!videoStartFailureOnly && !pendingVideoWatchStartOnly) {
    await checkLateVideoRewardCompletion();
  }
  if (!lateVideoRewardResponseOnly && !pendingVideoWatchStartOnly) {
    await checkVideoWatchStartFailure();
    console.log("PASS — failed video starts stay politely announced, keep focus in place, and cannot create a claim retry.");
  }
  if (pendingVideoWatchStartOnly) {
    await checkDelayedVideoWatchStart();
    await checkRepeatedProgressWhileVideoWatchStartPending();
  }
  const focusedVideoCheck = videoStartFailureOnly
    || lateVideoRewardResponseOnly
    || pendingVideoWatchStartOnly;
  for (const viewportWidth of (focusedVideoCheck ? [] : [375, 320])) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(120);

    for (const screen of screens) await checkScreen(screen, viewportWidth);
    for (const fontScale of [1.2, 1.35, 1.49, 1.5]) {
      await checkScreen(leaderboardDetailsScreen, viewportWidth, fontScale);
    }

    if (viewportWidth === 375) {
      await checkUnavailableVideoRewardFlow();
      await checkUnavailableVideoCatalogRefreshFailure();
      await checkTransientVideoRewardRetry();
      await checkDelayedVideoWatchStart();
      await checkRepeatedProgressWhileVideoWatchStartPending();
    }

    await navigateToScreen("Home", "GAME MODES");
    const navState = await evaluate(`(() => ({
      bar: (() => {
        const rect = document.querySelector('[data-testid="player-tab-bar"]')?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null;
      })(),
      height: document.querySelector('[data-testid="player-tab-bar"]')?.getBoundingClientRect().height,
      labels: [...document.querySelectorAll('[data-testid^="player-tab-label-"]')].map((node) => ({
        text: node.textContent.trim(),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        bounds: (() => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        })()
      }))
    }))()`);
    assert(navState.bar, `The bottom tab bar is missing at ${viewportWidth}px.`);
    const minimumTabBarHeight = viewportWidth <= 340 ? 148 : 90;
    assert(
      navState.height >= minimumTabBarHeight,
      `The tab bar did not provide enough height for 2× text at ${viewportWidth}px: ${JSON.stringify(navState)}.`,
    );
    assert(
      navState.labels.every((label) =>
        label.scrollWidth <= label.clientWidth + 2
          && label.scrollHeight <= label.clientHeight + 2
          && label.bounds.left >= navState.bar.left - 1
          && label.bounds.right <= navState.bar.right + 1
          && label.bounds.top >= navState.bar.top - 1
          && label.bounds.bottom <= navState.bar.bottom + 1
      ),
      `A bottom-tab label is clipped at ${viewportWidth}px: ${JSON.stringify(navState.labels)}.`,
    );
    for (const tab of ["home", "video", "earn", "wallet", "profile"]) {
      await checkReachable(`[data-testid="player-tab-${tab}"]`, `${tab} bottom tab`, true);
    }
  }
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(
    videoStartFailureOnly
      ? "PASS — video-start failure is announced clearly without moving focus or offering a false reward retry."
      : lateVideoRewardResponseOnly
        ? "PASS — late video completion responses cannot affect the next playback, and its own retry still works."
          : pendingVideoWatchStartOnly
            ? "PASS — repeated progress during a pending video start creates one session, and completion uses it."
      : "PASS — all twelve player screens at 375px and 320px at 2×, plus Weekly and Monthly leaderboard podiums, expanded rank/name/score rows, and rank-20 scrolling at 1.2×, 1.35×, 1.49×, and 1.5× Android text scale.",
  );
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