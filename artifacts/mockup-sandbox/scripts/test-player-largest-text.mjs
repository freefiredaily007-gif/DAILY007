import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sandboxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const browserErrors = [];
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
    root: document.querySelector('#root')?.innerHTML.slice(0, 500) ?? ''
  }))()`).catch((error) => ({ evaluationError: String(error) }));
  throw new Error(`${description} did not render: ${JSON.stringify(state)}`);
}

async function navigateToScreen(name, readyText) {
  await cdp("Page.navigate", { url: `http://127.0.0.1:${vitePort}/player-largest-text-preview.html?screen=${name}` });
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

async function checkScreen(screen, viewportWidth) {
  await navigateToScreen(screen.name, screen.ready);
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
      "document.body.innerText.includes('A Player Name That Needs Several Lines')",
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
    await clickSelector('[data-testid="profile-change-password"]', "Profile change password action");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"profile-password-submit\"]'))",
      "password-change dialog",
    );
    await checkReachable('[data-testid="profile-password-submit"]', "Profile password submit", true);
  } else if (screen.name === "Leaderboard") {
    await waitForCondition(
      "document.body.innerText.includes('International Tournament Competitor 12')",
      "the final leaderboard row",
    );
  } else if (screen.name === "LeaderboardDetails") {
    const getPodiumState = () => evaluate(`(() => ({
      text: document.querySelector('[data-testid="leaderboard-top-three"]')?.innerText ?? '',
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
        `The ${cycle} podium clips text inside an entry: ${JSON.stringify(entries)}`,
      );
      assert(
        entries.every((entry, index) => index === 0 || entries[index - 1].bounds[3] <= entry.bounds[2] + 1),
        `The ${cycle} podium entries overlap: ${JSON.stringify(entries.map((entry) => entry.bounds))}`,
      );
      assert(
        entries.every((entry) => entry.leaves.every((leaf) =>
          leaf.bounds[0] >= entry.bounds[0] - 1
            && leaf.bounds[1] <= entry.bounds[1] + 1
            && leaf.bounds[2] >= entry.bounds[2] - 1
            && leaf.bounds[3] <= entry.bounds[3] + 1
        )),
        `The ${cycle} podium text escapes its entry: ${JSON.stringify(entries)}`,
      );
    };
    const weeklyPodium = await getPodiumState();
    assert(
      weeklyPodium.text.includes("Weekly Champion With A Long Display Name"),
      `The weekly podium name is missing at 2× text: ${weeklyPodium.text}`,
    );
    assertPodiumGeometry(weeklyPodium.entries, "weekly");
    const weeklyScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile("/tmp/daily007-weekly-leaderboard-podium-2x.png", Buffer.from(weeklyScreenshot.data, "base64"));

    await clickSelector('[data-testid="leaderboard-top20-toggle"]', "weekly Top 20 toggle");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"leaderboard-player-20\"]'))",
      "expanded weekly ranks through 20",
    );
    const weeklyExpanded = await inspectLayout(screen.name);
    assert(
      weeklyExpanded.textIssues.length === 0,
      `The weekly expanded leaderboard clips text at 2× scale: ${JSON.stringify(weeklyExpanded.textIssues.slice(0, 8))}`,
    );
    const weeklyRow = await evaluate(`(() => {
      const row = document.querySelector('[data-testid="leaderboard-player-4"]');
      if (!row) return null;
      const main = row.firstElementChild;
      const score = row.lastElementChild;
      const children = [...(main?.children ?? [])];
      const boxes = children.map((node) => node.getBoundingClientRect());
      const mainBox = main?.getBoundingClientRect();
      const scoreBox = score?.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        text: row.innerText,
        children: boxes.map((box) => [box.left, box.right, box.top, box.bottom]),
        mainBottom: mainBox?.bottom,
        scoreTop: scoreBox?.top,
        scoreBounds: scoreBox && [scoreBox.left, scoreBox.right, scoreBox.top, scoreBox.bottom],
        rowBounds: [rowBox.left, rowBox.right, rowBox.top, rowBox.bottom],
      };
    })()`);
    assert(weeklyRow, "The weekly expanded rank-four row is missing.");
    assert(
      weeklyRow.text.includes("#4")
        && weeklyRow.text.includes("International Tournament Competitor With A Player Name That Wraps Across Multiple Lines")
        && weeklyRow.text.includes("17,076 Coins"),
      `The weekly expanded row omits its rank, full player name, or score: ${weeklyRow.text}`,
    );
    assert(
      weeklyRow.children.length === 3
        && weeklyRow.children.every((box, index, boxes) => index === 0 || boxes[index - 1][1] <= box[0] + 1)
        && weeklyRow.mainBottom <= weeklyRow.scoreTop + 1
        && weeklyRow.scoreBounds[0] >= weeklyRow.rowBounds[0] - 1
        && weeklyRow.scoreBounds[1] <= weeklyRow.rowBounds[1] + 1,
      `The weekly rank, name, and score overlap or escape the row: ${JSON.stringify(weeklyRow)}`,
    );
    await checkReachable('[data-testid="leaderboard-player-4"]', "expanded weekly rank-four row");
    const expandedRowScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(
      "/tmp/daily007-weekly-leaderboard-expanded-row-2x.png",
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
      assert(state && !state.missingScroll && state.scrollTop > 0, `The ${cycle} leaderboard did not scroll.`);
      assert(
        state.row[0] >= state.viewport[0] - 1 && state.row[1] <= state.viewport[1] + 1,
        `Rank 20 is not reachable in the ${cycle} leaderboard: ${JSON.stringify(state)}`,
      );
      assert(
        state.rowText.includes("#20") && state.rowText.includes("Rank Twenty Final Player") && state.rowText.includes("12,34,567 Coins"),
        `Rank 20 is missing its readable rank, name, or score for ${cycle}: ${state.rowText}`,
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
    assert(
      monthlyPodium.text.includes("Monthly Champion With A Long Display Name"),
      `The monthly podium name is missing at 2× text: ${monthlyPodium.text}`,
    );
    assertPodiumGeometry(monthlyPodium.entries, "monthly");
    const monthlyScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile("/tmp/daily007-monthly-leaderboard-podium-2x.png", Buffer.from(monthlyScreenshot.data, "base64"));
    const monthlyLayout = await inspectLayout(screen.name);
    assert(
      monthlyLayout.textIssues.length === 0,
      `The monthly podium clips text at 2× scale: ${JSON.stringify(monthlyLayout.textIssues.slice(0, 8))}`,
    );

    await clickSelector('[data-testid="leaderboard-top20-toggle"]', "monthly Top 20 toggle");
    await waitForCondition(
      "Boolean(document.querySelector('[data-testid=\"leaderboard-player-20\"]'))",
      "expanded monthly ranks through 20",
    );
    const monthlyExpanded = await inspectLayout(screen.name);
    assert(
      monthlyExpanded.textIssues.length === 0,
      `The monthly expanded leaderboard clips text at 2× scale: ${JSON.stringify(monthlyExpanded.textIssues.slice(0, 8))}`,
    );
    const monthlyRankFour = await evaluate(
      `document.querySelector('[data-testid="leaderboard-player-4"]')?.innerText ?? ''`,
    );
    assert(
      monthlyRankFour.includes("#4")
        && monthlyRankFour.includes("International Tournament Competitor With A Player Name That Wraps Across Multiple Lines")
        && monthlyRankFour.includes("17,076 Coins"),
      `The monthly expanded row omits its readable rank, full player name, or score: ${monthlyRankFour}`,
    );
    await checkRankTwentyReachable("monthly");
  } else if (screen.name === "Notifications") {
    await waitForCondition(
      "document.body.innerText.includes('Your prize coins were added to your wallet')",
      "the later notification",
    );
  } else if (screen.name === "EditProfile") {
    await checkReachable('[data-testid="edit-profile-save"]', "Edit Profile save action");
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
    await clickSelector('[data-testid="join-form-submit"]', "join form submit action");
    await waitForCondition(
      "document.body.innerText.includes('Insufficient wallet balance: this entry costs 7 coins.')",
      "server join error",
    );
    const joinText = await evaluate("document.body.innerText");
    assert(
      !joinText.includes("Registration confirmed") && !joinText.includes("Your slot is confirmed"),
      "A rejected join displayed a success confirmation.",
    );
  }

  console.log(`PASS — ${screen.name} at ${viewportWidth}px and 2× Android text scale.`);
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
  for (const viewportWidth of [375, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(120);

    for (const screen of screens) await checkScreen(screen, viewportWidth);

    if (viewportWidth === 375) {
      await checkUnavailableVideoRewardFlow();
      await checkTransientVideoRewardRetry();
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
  console.log("PASS — all twelve player screens at 375px and 320px, with join rejection messaging, video reward failure recovery, key actions, result rows, and bottom-tab labels at 2× Android text scale.");
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