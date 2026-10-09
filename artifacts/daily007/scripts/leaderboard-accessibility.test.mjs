import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  leaderboardPlayerAccessibilityLabel,
  leaderboardPodiumAccessibilityLabel,
  leaderboardRewardAccessibilityLabel,
  selectLeaderboardPodiumRanks,
  selectLeaderboardExpandedRows,
  selectLeaderboardTopTwenty,
} from "../src/lib/leaderboardStandings.ts";
import {
  getLeaderboardTopThreeUpdateAnnouncement,
  selectLeaderboardTopThreeSnapshot,
} from "../src/lib/leaderboardRefreshPolicy.ts";
import {
  getLeaderboardCycleFromRouteParam,
  handleLeaderboardCycleArrowKey,
} from "../src/lib/leaderboardCycleNavigation.ts";

const screenSource = await readFile(
  new URL("../src/screens/LeaderboardDetails.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const expectedTopTwentyRanks = Array.from({ length: 20 }, (_, index) => index + 1);
const expectedExpandedRanks = Array.from({ length: 17 }, (_, index) => index + 4);
const daily007Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(daily007Root, "../..");

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

async function waitForUrl(url, label, processToWatch) {
  const deadline = Date.now() + 30_000;
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

function pressableForTestId(testId) {
  const marker = `testID="${testId}"`;
  const markerIndex = screenSource.indexOf(marker);
  assert.ok(markerIndex >= 0, `Expected a control with testID ${testId}.`);
  const start = screenSource.lastIndexOf("<Pressable", markerIndex);
  const end = screenSource.indexOf("</Pressable>", markerIndex);
  assert.ok(start >= 0 && end > markerIndex, `Expected ${testId} on a Pressable.`);
  return screenSource.slice(start, end + "</Pressable>".length);
}

function textForTestId(testId) {
  const marker = `testID="${testId}"`;
  const markerIndex = screenSource.indexOf(marker);
  assert.ok(markerIndex >= 0, `Expected text with testID ${testId}.`);
  const start = screenSource.lastIndexOf("<Text", markerIndex);
  const end = screenSource.indexOf("</Text>", markerIndex);
  assert.ok(start >= 0 && end > markerIndex, `Expected ${testId} on a Text element.`);
  return screenSource.slice(start, end + "</Text>".length);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRetryQueryObserver(name, queryFn) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new QueryObserver(client, {
    queryKey: ["leaderboard-load-retry", name],
    queryFn,
    retry: false,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { client, observer, unsubscribe };
}

test("expanded player rows announce rank, player, and coin score as one ordered label", () => {
  const start = screenSource.indexOf("function PlayerRow(");
  const end = screenSource.indexOf("\nexport default function LeaderboardDetails", start);
  assert.ok(start >= 0 && end > start, "The leaderboard player row component must remain present.");

  const playerRowSource = screenSource.slice(start, end);
  const rootStart = playerRowSource.indexOf("<View");
  const rootEnd = playerRowSource.indexOf(">", rootStart);
  assert.ok(rootStart >= 0 && rootEnd > rootStart, "Each player row needs an accessible root.");

  const rootTag = playerRowSource.slice(rootStart, rootEnd + 1);
  assert.match(rootTag, /\baccessible\b/);
  assert.match(rootTag, /accessibilityRole="text"/);
  assert.match(rootTag, /testID=\{`leaderboard-player-\$\{standing\.rank\}`\}/);
  assert.match(rootTag, /accessibilityLabel=\{leaderboardPlayerAccessibilityLabel\(standing\)\}/);

  const avatarLocations = [
    playerRowSource.indexOf("styles.playerAvatarLarge"),
    playerRowSource.indexOf("styles.playerAvatar,"),
  ];
  for (const avatarStyleIndex of avatarLocations) {
    const avatarStart = playerRowSource.lastIndexOf("<View", avatarStyleIndex);
    const avatarEnd = playerRowSource.indexOf(">", avatarStart);
    assert.ok(avatarStart >= 0 && avatarEnd > avatarStyleIndex, "Each row avatar needs an accessible wrapper.");
    const avatarTag = playerRowSource.slice(avatarStart, avatarEnd + 1);
    assert.match(avatarTag, /accessibilityElementsHidden/);
    assert.match(avatarTag, /importantForAccessibility="no-hide-descendants"/);
  }
  assert.equal(
    (playerRowSource.match(/<Text accessible=\{false\} style=\{styles\.coinEmoji\}>🪙<\/Text>/g) ?? []).length,
    2,
    "Both expanded-row layouts must hide the decorative coin icon.",
  );

  const label = leaderboardPlayerAccessibilityLabel({
    rank: 4,
    name: "Test Player",
    points: 120_000,
  });
  assert.equal(label, `Rank 4, Test Player, ${(120_000).toLocaleString("en-IN")} coins`);
});

test("podium entries expose one ordered VoiceOver label without decorative stops", () => {
  const start = screenSource.indexOf("function PodiumEntry(");
  const end = screenSource.indexOf("\nfunction PlayerRow(", start);
  assert.ok(start >= 0 && end > start, "The podium entry component must remain present.");
  const podiumSource = screenSource.slice(start, end);

  const rootStart = podiumSource.indexOf("<View");
  const rootEnd = podiumSource.indexOf(">", rootStart);
  assert.ok(rootStart >= 0 && rootEnd > rootStart, "Each podium entry needs an accessible root.");
  const rootTag = podiumSource.slice(rootStart, rootEnd + 1);
  assert.match(rootTag, /\baccessible\b/);
  assert.match(rootTag, /accessibilityRole="text"/);
  assert.match(rootTag, /testID=\{`leaderboard-podium-\$\{rank\}`\}/);
  assert.match(rootTag, /accessibilityLabel=\{leaderboardPodiumAccessibilityLabel\(rank, standing\)\}/);

  const avatarStyleIndex = podiumSource.indexOf("styles.podiumAvatar,");
  const avatarStart = podiumSource.lastIndexOf("<View", avatarStyleIndex);
  const avatarEnd = podiumSource.indexOf(">", avatarStart);
  const avatarTag = podiumSource.slice(avatarStart, avatarEnd + 1);
  assert.match(avatarTag, /accessibilityElementsHidden/);
  assert.match(avatarTag, /importantForAccessibility="no-hide-descendants"/);

  const initialsStyleIndex = podiumSource.indexOf("styles.podiumInitial,");
  const initialsStart = podiumSource.lastIndexOf("<Text", initialsStyleIndex);
  const initialsEnd = podiumSource.indexOf(">", initialsStart);
  assert.match(podiumSource.slice(initialsStart, initialsEnd + 1), /accessible=\{false\}/);
  assert.equal(
    (podiumSource.match(/<Text accessible=\{false\} style=\{styles\.coinEmoji\}>🪙<\/Text>/g) ?? []).length,
    2,
    "Both podium layouts must hide the decorative coin icon.",
  );

  const label = leaderboardPodiumAccessibilityLabel(1, {
    name: "Top Player",
    points: 120_000,
  });
  assert.equal(label, `Rank 1, Top Player, ${(120_000).toLocaleString("en-IN")} coins`);
  for (const rank of [1, 2, 3]) {
    assert.equal(
      leaderboardPodiumAccessibilityLabel(rank),
      `Rank ${rank}, player not available, coin score not available`,
    );
  }
});

test("weekly and monthly prize tiers announce each rank and amount once in rank order", () => {
  const rewardsStart = screenSource.indexOf("{period?.rewards ? (");
  const rewardsEnd = screenSource.indexOf("{query.isLoading ? (", rewardsStart);
  assert.ok(rewardsStart >= 0 && rewardsEnd > rewardsStart, "The prize schedule must remain available for the selected cycle.");
  const rewardsSource = screenSource.slice(rewardsStart, rewardsEnd);

  assert.match(rewardsSource, /testID=\{`leaderboard-rewards-\$\{cycle\}`\}/);
  assert.match(rewardsSource, /\[1, 2, 3\]\.map\(\(rank\) => \{/);
  assert.match(rewardsSource, /period\.rewards\.find\(\(reward\) => reward\.rank === rank\)\?\.coins \?\? 0/);

  const rowMarker = rewardsSource.indexOf("testID={`leaderboard-reward-rank-${rank}`}");
  const rowStart = rewardsSource.lastIndexOf("<View", rowMarker);
  const rowEnd = rewardsSource.indexOf(">", rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart, "Each prize tier needs a grouped accessible row.");
  const rowTag = rewardsSource.slice(rowStart, rowEnd + 1);
  assert.match(rowTag, /accessible/);
  assert.match(rowTag, /accessibilityRole="text"/);
  assert.match(rowTag, /accessibilityLabel=\{leaderboardRewardAccessibilityLabel\(rank, coins\)\}/);
  assert.match(rowTag, /testID=\{`leaderboard-reward-rank-\$\{rank\}`\}/);
  assert.equal(
    (rewardsSource.match(/<Text accessible=\{false\} style=/g) ?? []).length,
    2,
    "The visible rank and amount must not create extra stops inside the grouped row.",
  );

  for (const [cycle, prizes] of [
    ["Weekly", [12_000, 8_000, 4_000]],
    ["Monthly", [50_000, 30_000, 15_000]],
  ]) {
    const spokenLabels = prizes.map((coins, index) =>
      leaderboardRewardAccessibilityLabel(index + 1, coins),
    );
    assert.deepEqual(
      spokenLabels,
      prizes.map((coins, index) =>
        `Rank ${index + 1}, ${coins.toLocaleString("en-IN")} coins`,
      ),
      `${cycle} prize labels must associate each amount with its rank.`,
    );
    assert.deepEqual(
      spokenLabels.map((label) => Number(label.match(/^Rank (\d+),/)?.[1])),
      [1, 2, 3],
      `${cycle} prize tiers must be reached once in rank order.`,
    );
  }
});

for (const [cycle, standings] of [
  [
    "Weekly",
    [
      { name: "Asha", points: 120_000 },
      { name: "Bimal", points: 95_000 },
      { name: "Chandra", points: 80_000 },
    ],
  ],
  [
    "Monthly",
    [
      { name: "Dev", points: 420_000 },
      { name: "Esha", points: 350_000 },
      { name: "Farah", points: 290_000 },
    ],
  ],
]) {
  test(`${cycle} podium labels distinguish ranks, names, and scores`, () => {
    const spokenLabels = standings.map((standing, index) =>
      leaderboardPodiumAccessibilityLabel(index + 1, standing),
    );

    assert.deepEqual(
      spokenLabels,
      standings.map(
        (standing, index) =>
          `Rank ${index + 1}, ${standing.name}, ${standing.points.toLocaleString("en-IN")} coins`,
      ),
    );
    assert.equal(new Set(spokenLabels).size, 3, "Each podium entry must have a distinct spoken label.");
  });
}

test("podium VoiceOver traversal follows the visible order in both layouts", () => {
  const standardOrder = selectLeaderboardPodiumRanks(false);
  const largeTextOrder = selectLeaderboardPodiumRanks(true);
  assert.deepEqual(standardOrder, [2, 1, 3], "The standard podium is read left to right.");
  assert.deepEqual(largeTextOrder, [1, 2, 3], "The large-text podium is read top to bottom.");
  for (const order of [standardOrder, largeTextOrder]) {
    assert.equal(new Set(order).size, 3, "Each podium rank must appear exactly once.");
    assert.deepEqual([...order].sort(), [1, 2, 3], "Every podium rank must be reachable.");
  }

  assert.match(screenSource, /const podium = selectLeaderboardPodiumRanks\(largeText\)\.map\(\(rank\) => \(/);
  assert.match(
    screenSource,
    /\{podium\.map\(\(\{ rank, standing \}\) => \(\s*<PodiumEntry key=\{rank\} rank=\{rank\} standing=\{standing\} largeText=\{largeText\} \/>/,
  );
  assert.match(screenSource, /podium: \{ flexDirection: "row"/);
  assert.match(screenSource, /podiumLarge: \{ flexDirection: "column"/);
});

test("top-three refresh changes announce affected ranks, players, and scores", () => {
  const previous = selectLeaderboardTopThreeSnapshot([
    { rank: 1, userId: "player-a", name: "Asha", points: 120_000 },
    { rank: 2, userId: "player-b", name: "Bimal", points: 95_000 },
    { rank: 3, userId: "player-c", name: "Chandra", points: 80_000 },
  ]);
  const current = selectLeaderboardTopThreeSnapshot([
    { rank: 1, userId: "player-b", name: "Bimal", points: 95_000 },
    { rank: 2, userId: "player-a", name: "Asha", points: 125_000 },
    { rank: 3, userId: "player-c", name: "Chandra", points: 80_000 },
  ]);

  assert.equal(
    getLeaderboardTopThreeUpdateAnnouncement(previous, current),
    `Leaderboard updated. Rank 1, Bimal, ${(95_000).toLocaleString("en-IN")} coins; Rank 2, Asha, ${(125_000).toLocaleString("en-IN")} coins.`,
  );
});

test("identical top-three refresh data does not create a repeat announcement", () => {
  const standings = [
    { rank: 1, userId: "player-a", name: "Asha", points: 120_000 },
    { rank: 2, userId: "player-b", name: "Bimal", points: 95_000 },
    { rank: 3, userId: "player-c", name: "Chandra", points: 80_000 },
  ];
  const previous = selectLeaderboardTopThreeSnapshot(standings);
  const refreshed = selectLeaderboardTopThreeSnapshot(standings.map((standing) => ({ ...standing })));

  assert.notEqual(previous, refreshed, "A refresh must be compared by values, not array identity.");
  assert.equal(getLeaderboardTopThreeUpdateAnnouncement(previous, refreshed), null);
});

test("top-three announcements are polite on Android and queued at low priority on iOS", () => {
  const announcement = textForTestId("leaderboard-top-three-update");
  assert.match(announcement, /accessible=\{false\}/);
  assert.match(announcement, /accessibilityLiveRegion="polite"/);
  assert.match(
    screenSource,
    /AccessibilityInfo\.announceForAccessibilityWithOptions\(announcement, \{\s*queue: true,\s*priority: "low",\s*\}\)/,
  );
  assert.match(screenSource, /if \(!previousSnapshot\) return;/);
  assert.match(screenSource, /if \(!announcement\) return;/);
});

test("the Top 20 control exposes and toggles its expanded state", () => {
  const topTwentyControl = pressableForTestId("leaderboard-top20-toggle");
  assert.match(topTwentyControl, /accessibilityRole="button"/);
  assert.match(topTwentyControl, /accessibilityLabel="Top 20 players"/);
  assert.match(topTwentyControl, /accessibilityState=\{\{ expanded: showTop20 \}\}/);
  assert.match(topTwentyControl, /onPress=\{\(\) => setShowTop20\(\(expanded\) => !expanded\)\}/);

  const expandedStart = screenSource.indexOf("{showTop20 ? (");
  const expandedRowsIndex = screenSource.indexOf("remainingPlayers.map", expandedStart);
  const expandedEnd = screenSource.indexOf(") : null}", expandedRowsIndex);
  assert.ok(expandedStart >= 0 && expandedEnd > expandedStart);
  const expandedContent = screenSource.slice(expandedStart, expandedEnd);
  assert.match(expandedContent, /remainingPlayers\.map\(\(standing\) => \(/);
  assert.match(expandedContent, /<PlayerRow/);
});

test("cycle tabs expose their names and selection, and switching closes the expanded list", () => {
  const tabsStart = screenSource.indexOf('(["weekly", "monthly"] as const).map((key) => {');
  const tabsEnd = screenSource.indexOf("</View>", tabsStart);
  assert.ok(tabsStart >= 0 && tabsEnd > tabsStart, "Both cycle tabs must be rendered in their tab list.");

  const tablistStart = screenSource.lastIndexOf("<View", tabsStart);
  const tablistProps = screenSource.slice(tablistStart, tabsStart);
  assert.match(tablistProps, /accessibilityRole="tablist"/);
  assert.match(tablistProps, /\{\.\.\.tablistKeyboardProps\}/);

  const keyboardPropsStart = screenSource.indexOf("const tablistKeyboardProps:");
  const keyboardPropsEnd = screenSource.indexOf("\n  const data =", keyboardPropsStart);
  assert.ok(keyboardPropsStart >= 0 && keyboardPropsEnd > keyboardPropsStart);
  const keyboardProps = screenSource.slice(keyboardPropsStart, keyboardPropsEnd);
  assert.match(keyboardProps, /Platform\.OS === "web"/);
  assert.match(
    keyboardProps,
    /handleLeaderboardCycleArrowKey\(cycle, event\.nativeEvent\.key, \{/,
  );
  assert.match(keyboardProps, /nextTabRef\.current\?\.focus\(\);/);
  assert.match(keyboardProps, /selectCycle,/);

  const cycleTabs = screenSource.slice(tabsStart, tabsEnd);
  assert.match(cycleTabs, /accessibilityRole="tab"/);
  assert.match(cycleTabs, /accessibilityState=\{\{ selected \}\}/);
  assert.match(
    cycleTabs,
    /tabIndex=\{Platform\.OS === "web" \? \(selected \? 0 : -1\) : undefined\}/,
  );
  assert.match(
    cycleTabs,
    /accessibilityLabel=\{key === "weekly" \? "Weekly leaderboard" : "Monthly leaderboard"\}/,
  );
  assert.match(cycleTabs, /testID=\{`leaderboard-details-tab-\$\{key\}`\}/);
  assert.match(cycleTabs, /ref=\{key === "weekly" \? weeklyTabRef : monthlyTabRef\}/);
  assert.match(cycleTabs, /const selected = cycle === key;/);

  const selectedCycleOnRoute = screenSource.match(
    /const cycle: CycleType = getLeaderboardCycleFromRouteParam\(route\?\.params\?\.cycleType\);/,
  );
  assert.ok(selectedCycleOnRoute, "The selected tab must follow the currently displayed cycle.");

  assert.match(cycleTabs, /onPress=\{\(\) => selectCycle\(key\)\}/);
  assert.match(
    screenSource,
    /const selectCycle = \(nextCycle: CycleType\) => \{\s*setShowTop20\(false\);\s*navigation\.setParams\(\{ cycleType: nextCycle \}\);\s*\};/,
  );
  assert.match(screenSource, /const period = data\?\.\[cycle\];/);
});

test("left and right arrows move focus, select the tab, and display its leaderboard cycle", () => {
  const cases = [
    { focused: "weekly", key: "ArrowRight", expected: "monthly" },
    { focused: "monthly", key: "ArrowRight", expected: "weekly" },
    { focused: "weekly", key: "ArrowLeft", expected: "monthly" },
    { focused: "monthly", key: "ArrowLeft", expected: "weekly" },
  ];
  const periods = {
    weekly: { cycle: "weekly", label: "Weekly standings" },
    monthly: { cycle: "monthly", label: "Monthly standings" },
  };

  for (const { focused, key, expected } of cases) {
    let focusedTab = focused;
    let routeCycleType = focused;
    let preventedDefault = false;
    const nextCycle = handleLeaderboardCycleArrowKey(focused, key, {
      preventDefault: () => {
        preventedDefault = true;
      },
      focusTab: (cycle) => {
        focusedTab = cycle;
      },
      selectCycle: (cycle) => {
        routeCycleType = cycle;
      },
    });
    const displayedCycle = getLeaderboardCycleFromRouteParam(routeCycleType);

    assert.equal(nextCycle, expected);
    assert.equal(preventedDefault, true);
    assert.equal(focusedTab, expected);
    assert.equal(displayedCycle, expected);
    assert.equal(periods[displayedCycle].cycle, expected);
    assert.equal(periods[displayedCycle].label, `${expected === "weekly" ? "Weekly" : "Monthly"} standings`);
  }

  let ignoredKeySideEffects = 0;
  assert.equal(
    handleLeaderboardCycleArrowKey("weekly", "Enter", {
      preventDefault: () => ignoredKeySideEffects++,
      focusTab: () => ignoredKeySideEffects++,
      selectCycle: () => ignoredKeySideEffects++,
    }),
    null,
  );
  assert.equal(ignoredKeySideEffects, 0, "Enter must remain available to native tab activation.");
});

test("browser arrow keys keep leaderboard focus, selected state, and standings in sync", async () => {
  const vitePort = await getFreePort();
  let debugPort = await getFreePort();
  while (debugPort === vitePort) debugPort = await getFreePort();
  const temporaryProfile = await mkdtemp(path.join(os.tmpdir(), "daily007-leaderboard-tabs-"));
  const browserErrors = [];
  const pending = new Map();
  let viteOutput = "";
  let vite;
  let chromium;
  let socket;
  let messageId = 0;

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

  async function waitForCondition(expression, label) {
    const deadline = Date.now() + 30_000;
    let lastValue;
    while (Date.now() < deadline) {
      lastValue = await evaluate(expression);
      if (lastValue) return;
      await delay(100);
    }
    throw new Error(`${label} did not become ready. Last value: ${String(lastValue)}`);
  }

  async function pressArrow(key) {
    const virtualKeyCode = key === "ArrowLeft" ? 37 : 39;
    const keyData = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...keyData });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...keyData });
  }

  function checkBrowserMessage(message) {
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
  }

  try {
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
    await waitForUrl(
      `http://127.0.0.1:${vitePort}/player-largest-text-preview.html`,
      "Leaderboard React Native Web preview",
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
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, "Headless Chromium", chromium);
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await targetResponse.json();
    const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    assert.ok(pageTarget, "Chromium did not expose a page target.");
    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chromium DevTools.")), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        socket.addEventListener("message", ({ data }) => {
          checkBrowserMessage(JSON.parse(String(data)));
        });
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Chromium DevTools WebSocket failed."));
      });
    });
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 900,
      screenWidth: 1024,
      screenHeight: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/player-largest-text-preview.html?screen=LeaderboardDetails&platform=web&fontScale=1`,
    });
    await waitForCondition(
      `Boolean(document.querySelector('[data-testid="leaderboard-details-tab-weekly"]') &&
        document.querySelector('[data-testid="leaderboard-details-tab-monthly"]') &&
        document.querySelector('[data-testid="leaderboard-podium-1"]'))`,
      "Rendered leaderboard tabs and standings",
    );

    const getTabState = () => evaluate(`(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const champion = document.querySelector('[data-testid="leaderboard-podium-1"]');
      return {
        focused: document.activeElement?.getAttribute("data-testid") ?? null,
        tabs: tabs.map((tab) => ({
          id: tab.getAttribute("data-testid"),
          selected: tab.getAttribute("aria-selected"),
          tabIndex: tab.tabIndex,
        })),
        champion: champion?.textContent ?? "",
      };
    })()`);

    const assertSelectedCycle = async (cycle, championName) => {
      const tabId = `leaderboard-details-tab-${cycle}`;
      const state = await getTabState();
      assert.equal(state.focused, tabId, `${cycle} tab should own browser focus.`);
      assert.deepEqual(
        state.tabs.map(({ id, selected, tabIndex }) => ({ id, selected, tabIndex })),
        [
          {
            id: "leaderboard-details-tab-weekly",
            selected: cycle === "weekly" ? "true" : "false",
            tabIndex: cycle === "weekly" ? 0 : -1,
          },
          {
            id: "leaderboard-details-tab-monthly",
            selected: cycle === "monthly" ? "true" : "false",
            tabIndex: cycle === "monthly" ? 0 : -1,
          },
        ],
        `${cycle} selection and roving tab focus index should match.`,
      );
      assert.match(state.champion, new RegExp(championName), `${cycle} standings should be displayed.`);
      assert.doesNotMatch(
        state.champion,
        new RegExp(cycle === "weekly" ? "Monthly Champion" : "Weekly Champion"),
        `Standings for the other cycle should not be displayed as the selected cycle.`,
      );
    };

    const initiallyFocused = await evaluate(`(() => {
      const weekly = document.querySelector('[data-testid="leaderboard-details-tab-weekly"]');
      weekly?.focus();
      return document.activeElement === weekly;
    })()`);
    assert.equal(initiallyFocused, true, "The selected Weekly tab should accept browser focus.");
    await assertSelectedCycle("weekly", "Weekly Champion");

    await pressArrow("ArrowLeft");
    await waitForCondition(
      `document.activeElement?.getAttribute("data-testid") === "leaderboard-details-tab-monthly" &&
        document.querySelector('[data-testid="leaderboard-details-tab-monthly"]')?.getAttribute("aria-selected") === "true" &&
        document.querySelector('[data-testid="leaderboard-podium-1"]')?.textContent.includes("Monthly Champion")`,
      "ArrowLeft to move focus, selection, and standings to Monthly",
    );
    await assertSelectedCycle("monthly", "Monthly Champion");

    await pressArrow("ArrowRight");
    await waitForCondition(
      `document.activeElement?.getAttribute("data-testid") === "leaderboard-details-tab-weekly" &&
        document.querySelector('[data-testid="leaderboard-details-tab-weekly"]')?.getAttribute("aria-selected") === "true" &&
        document.querySelector('[data-testid="leaderboard-podium-1"]')?.textContent.includes("Weekly Champion")`,
      "ArrowRight to move focus, selection, and standings to Weekly",
    );
    await assertSelectedCycle("weekly", "Weekly Champion");
    assert.deepEqual(browserErrors, [], `Browser reported errors: ${browserErrors.join(" | ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (browserErrors.length) console.error(`Browser errors: ${browserErrors.join(" | ")}`);
    if (viteOutput.trim()) console.error(`Vite output:\n${viteOutput.trim()}`);
    throw new Error(message, { cause: error });
  } finally {
    try { socket?.close(); } catch {}
    for (const child of [chromium, vite]) {
      if (!child || child.exitCode !== null) continue;
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await rm(temporaryProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, { timeout: 120_000 });

test("empty and unavailable leaderboard guidance is exposed as readable text", () => {
  const noAwards = textForTestId("leaderboard-no-awards-guidance");
  assert.match(noAwards, /\baccessible\b/);
  assert.match(noAwards, /accessibilityRole="text"/);
  assert.match(noAwards, /No match awards yet this cycle\.\s*Rankings update when tournament results are published\./);

  const emptyDateRange = textForTestId("leaderboard-empty-date-range");
  assert.match(emptyDateRange, /\baccessible\b/);
  assert.match(emptyDateRange, /accessibilityRole="text"/);
  assert.match(emptyDateRange, /\{dateRange\(period\)\}/);
  assert.match(textForTestId("leaderboard-populated-date-range"), /accessibilityRole="text"/);

  const unavailable = textForTestId("leaderboard-unavailable-guidance");
  assert.match(unavailable, /\baccessible\b/);
  assert.match(unavailable, /accessibilityRole="text"/);
  assert.match(unavailable, /Leaderboard data is not available yet\./);

  const error = textForTestId("leaderboard-error-guidance");
  assert.match(error, /\baccessible\b/);
  assert.match(error, /accessibilityRole="text"/);
  assert.match(error, /Leaderboard is unavailable: \$\{apiError\(query\.error\)\}/);
});

test("a no-data API error exposes an accessible retry action", () => {
  const retryButton = pressableForTestId("leaderboard-retry-button");
  assert.match(retryButton, /accessible/);
  assert.match(retryButton, /accessibilityRole="button"/);
  assert.match(retryButton, /accessibilityLabel="Retry leaderboard load"/);
  assert.match(retryButton, /onPress=\{\(\) => void query\.refetch\(\)\}/);
  assert.match(retryButton, /<Text style=\{styles\.retryButtonText\}>Try again<\/Text>/);

  const errorBranchStart = screenSource.indexOf(") : query.error && !period ? (");
  const errorBranchEnd = screenSource.indexOf(") : !period ? (", errorBranchStart);
  assert.ok(errorBranchStart >= 0 && errorBranchEnd > errorBranchStart);
  assert.match(screenSource.slice(errorBranchStart, errorBranchEnd), /leaderboard-retry-button/);
});

test("a failed refresh with a selected cached period announces that results may be stale", () => {
  const warning = textForTestId("leaderboard-stale-data-warning");
  const retryButton = pressableForTestId("leaderboard-stale-retry-button");
  assert.match(warning, /\baccessible\b/);
  assert.match(warning, /accessibilityRole="text"/);
  assert.match(warning, /accessibilityLiveRegion="polite"/);
  assert.match(
    warning,
    /Couldn't refresh the leaderboard\. Showing saved results, which may be out of date\./,
  );
  assert.match(retryButton, /accessible/);
  assert.match(retryButton, /accessibilityRole="button"/);
  assert.match(retryButton, /accessibilityLabel="Retry leaderboard refresh"/);
  assert.match(retryButton, /accessibilityState=\{\{ disabled: query\.isFetching, busy: query\.isFetching \}\}/);
  assert.match(retryButton, /disabled=\{query\.isFetching\}/);
  assert.match(retryButton, /onPress=\{\(\) => void query\.refetch\(\)\}/);
  assert.match(retryButton, /<Text style=\{styles\.retryButtonText\}>Try again<\/Text>/);
  assert.match(
    screenSource,
    /\{query\.isRefetchError && period \? \(\s*<View style=\{styles\.staleDataWarning\}>[\s\S]*?testID="leaderboard-stale-data-warning"[\s\S]*?leaderboard-stale-retry-button/,
    "Only a failed background refresh with the selected period still available should show the stale warning.",
  );
});

test("loading, error, unavailable, empty, and populated states stay distinct", () => {
  const branchMarkers = [
    "{query.isLoading ? (",
    ") : query.error && !period ? (",
    ") : !period ? (",
    ") : standings.length === 0 ? (",
    ") : (",
  ];
  let searchFrom = 0;
  const branchIndexes = branchMarkers.map((marker) => {
    const index = screenSource.indexOf(marker, searchFrom);
    searchFrom = index + marker.length;
    return index;
  });
  assert.ok(
    branchIndexes.every((index, position) => index >= 0 && (position === 0 || index > branchIndexes[position - 1])),
    "Loading, error, missing-period, empty, and populated branches must remain separate and ordered.",
  );
  assert.match(
    screenSource.slice(branchIndexes[0], branchIndexes[1]),
    /<Loading accessibilityLabel="Loading leaderboard" \/>/,
  );

  const loadingStart = uiSource.indexOf("export function Loading(");
  const loadingEnd = uiSource.indexOf("\n}\n", loadingStart);
  assert.ok(loadingStart >= 0 && loadingEnd > loadingStart, "The shared loading indicator must remain present.");
  const loadingComponent = uiSource.slice(loadingStart, loadingEnd);
  assert.match(loadingComponent, /accessibilityRole=\{accessibilityLabel \? "progressbar" : undefined\}/);
  assert.match(loadingComponent, /accessibilityLabel=\{accessibilityLabel\}/);
});

test("a leaderboard retry succeeds and shows a distinct loading state", async () => {
  const retryResponse = createDeferred();
  let requestCount = 0;
  const { client, observer, unsubscribe } = createRetryQueryObserver(
    "success",
    async () => {
      requestCount += 1;
      if (requestCount === 1) throw new Error("temporary API error");
      return retryResponse.promise;
    },
  );

  try {
    const initialFailure = await observer.refetch();
    assert.equal(initialFailure.isError, true);
    assert.equal(initialFailure.data, undefined);

    const retryRequest = observer.refetch();
    const retrying = observer.getCurrentResult();
    assert.equal(retrying.isLoading, true);
    assert.equal(retrying.isError, false);
    assert.equal(retrying.isFetching, true);

    retryResponse.resolve({
      weekly: { standings: [{ rank: 1, userId: "player-1", name: "Asha", points: 12 }] },
    });
    const recovered = await retryRequest;
    assert.equal(recovered.isSuccess, true);
    assert.equal(recovered.data.weekly.standings[0].name, "Asha");
    assert.equal(requestCount, 2);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("a leaderboard retry that fails again restores the no-data error state", async () => {
  const retryResponse = createDeferred();
  let requestCount = 0;
  const { client, observer, unsubscribe } = createRetryQueryObserver(
    "failure",
    async () => {
      requestCount += 1;
      if (requestCount === 1) throw new Error("initial API error");
      return retryResponse.promise;
    },
  );

  try {
    const initialFailure = await observer.refetch();
    assert.equal(initialFailure.isError, true);
    assert.equal(initialFailure.data, undefined);

    const retryRequest = observer.refetch();
    const retrying = observer.getCurrentResult();
    assert.equal(retrying.isLoading, true);
    assert.equal(retrying.isError, false);
    assert.equal(retrying.isFetching, true);

    retryResponse.reject(new Error("API is still unavailable"));
    const repeatedFailure = await retryRequest;
    assert.equal(repeatedFailure.isError, true);
    assert.equal(repeatedFailure.isLoading, false);
    assert.equal(repeatedFailure.isFetching, false);
    assert.equal(repeatedFailure.data, undefined);
    assert.equal(repeatedFailure.error.message, "API is still unavailable");
    assert.equal(requestCount, 2);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("retrying stale standings keeps them visible through success and repeated failure", async () => {
  const savedData = {
    weekly: {
      standings: [{ rank: 1, userId: "saved-player", name: "Saved Player", points: 120 }],
    },
  };
  const refreshedData = {
    weekly: {
      standings: [{ rank: 1, userId: "updated-player", name: "Updated Player", points: 150 }],
    },
  };
  const pendingRetry = createDeferred();
  const pendingRepeatedFailure = createDeferred();
  let requestCount = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new QueryObserver(client, {
    queryKey: ["leaderboard-stale-data-retry"],
    queryFn: async () => {
      requestCount += 1;
      if (requestCount === 1) throw new Error("Temporary refresh failure");
      if (requestCount === 2) return pendingRetry.promise;
      return pendingRepeatedFailure.promise;
    },
    initialData: savedData,
    retry: false,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});

  try {
    const initialFailure = await observer.refetch();
    assert.equal(initialFailure.isRefetchError, true);
    assert.equal(initialFailure.data.weekly.standings[0].name, "Saved Player");

    const retryRequest = observer.refetch();
    const retrying = observer.getCurrentResult();
    assert.equal(retrying.isFetching, true);
    assert.equal(retrying.isRefetchError, true);
    assert.equal(retrying.data.weekly.standings[0].name, "Saved Player");

    pendingRetry.resolve(refreshedData);
    const recovered = await retryRequest;
    assert.equal(recovered.isSuccess, true);
    assert.equal(recovered.isRefetchError, false);
    assert.equal(recovered.data.weekly.standings[0].name, "Updated Player");

    const repeatedRetryRequest = observer.refetch();
    const repeatedRetrying = observer.getCurrentResult();
    assert.equal(repeatedRetrying.isFetching, true);
    assert.equal(repeatedRetrying.data.weekly.standings[0].name, "Updated Player");

    pendingRepeatedFailure.reject(new Error("API is still unavailable"));
    const repeatedFailure = await repeatedRetryRequest;
    assert.equal(repeatedFailure.isRefetchError, true);
    assert.equal(repeatedFailure.data.weekly.standings[0].name, "Updated Player");
    assert.equal(requestCount, 3);
  } finally {
    unsubscribe();
    client.clear();
  }
});

for (const [cycle, ranks] of [
  ["Weekly", [20, 7, 14, 1, 23, 3, 16, 10, 2, 19, 6, 13, 22, 4, 18, 9, 15, 5, 12, 21, 8, 17, 11]],
  ["Monthly", [22, 4, 19, 11, 1, 17, 8, 20, 13, 3, 16, 7, 21, 2, 15, 10, 18, 5, 14, 9, 12, 6]],
]) {
  test(`${cycle} expanded entries stay ordered by rank`, () => {
    const data = ranks.map((rank) => ({
      rank,
      userId: `${cycle.toLowerCase()}-${rank}`,
      name: `${cycle} Player ${rank}`,
      points: rank * 100,
    }));
    const topTwenty = selectLeaderboardTopTwenty(data);
    const expandedRows = selectLeaderboardExpandedRows(topTwenty);
    const spokenLabels = topTwenty.map(leaderboardPlayerAccessibilityLabel);

    assert.deepEqual(topTwenty.map((standing) => standing.rank), expectedTopTwentyRanks);
    assert.deepEqual(expandedRows.map((standing) => standing.rank), expectedExpandedRanks);
    assert.equal(new Set(spokenLabels).size, 20, "Every Top 20 entry must have a distinguishable spoken label.");
    assert.deepEqual(
      spokenLabels.map((label) => label.match(/^Rank (\d+),/)?.[1]),
      expectedTopTwentyRanks.map(String),
    );
    assert.equal(
      spokenLabels[19],
      `Rank 20, ${cycle} Player 20, ${(20 * 100).toLocaleString("en-IN")} coins`,
      "Rank 20 must announce its rank, player, and score.",
    );
  });
}

test("the screen selects the active Weekly or Monthly period before ranking its entries", () => {
  assert.match(
    screenSource,
    /const cycle: CycleType = getLeaderboardCycleFromRouteParam\(route\?\.params\?\.cycleType\);/,
  );
  assert.match(screenSource, /const period = data\?\.\[cycle\];/);
  assert.match(screenSource, /const standings = selectLeaderboardTopTwenty\(period\?\.standings\);/);
  assert.match(screenSource, /const remainingPlayers = selectLeaderboardExpandedRows\(standings\);/);
});