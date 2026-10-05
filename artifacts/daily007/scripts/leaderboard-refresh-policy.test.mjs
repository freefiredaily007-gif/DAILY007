import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import {
  LEADERBOARD_REFRESH_POLICY,
  refetchLeaderboardOnFocus,
} from "../src/lib/leaderboardRefreshPolicy.ts";

const leaderboardSource = readFileSync(
  new URL("../src/screens/LeaderboardDetails.tsx", import.meta.url),
  "utf8",
);
const leaderboardSourceFile = ts.createSourceFile(
  "LeaderboardDetails.tsx",
  leaderboardSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findRewardPanelExpression() {
  let rewardPanelExpression;

  function visit(node) {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isConditionalExpression(node.expression) &&
      node.expression.condition.getText(leaderboardSourceFile) === "period?.rewards"
    ) {
      rewardPanelExpression = node.expression;
    }
    ts.forEachChild(node, visit);
  }

  visit(leaderboardSourceFile);
  assert.ok(
    rewardPanelExpression,
    "LeaderboardDetails should render its reward panel from the selected period.",
  );
  return rewardPanelExpression;
}

function renderRewardPanel(cycle, period) {
  const expression = findRewardPanelExpression();
  const source = `const __fixtureElement = (${expression.getText(leaderboardSourceFile)});`;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const View = ({ children, testID, accessibilityLabel }) => {
    const props = {};
    if (testID) props["data-testid"] = testID;
    if (accessibilityLabel) props["aria-label"] = accessibilityLabel;
    return React.createElement("div", props, children);
  };
  const Text = ({ children }) => React.createElement("span", null, children);
  const scope = {
    React,
    View,
    Text,
    styles: {},
    cycle,
    period,
    accent: cycle === "weekly" ? "#weekly" : "#monthly",
    C: { gold: "#gold", sub: "#silver", orange: "#orange" },
  };
  const element = new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __fixtureElement;`,
  )(...Object.values(scope));
  return renderToStaticMarkup(element);
}

function playerPeriodsFromFullAdminSchedule(schedule) {
  const toPeriod = (cycleType) => {
    const rewards = schedule[cycleType];
    return {
      cycleType,
      status: "active",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-12T00:00:00.000Z",
      standings: [],
      rewards: [
        { rank: 1, coins: rewards.firstPlaceCoins },
        { rank: 2, coins: rewards.secondPlaceCoins },
        { rank: 3, coins: rewards.thirdPlaceCoins },
      ],
    };
  };
  return { weekly: toPeriod("weekly"), monthly: toPeriod("monthly") };
}

function expectedCoins(schedule, rank) {
  if (rank === 1) return schedule.firstPlaceCoins;
  if (rank === 2) return schedule.secondPlaceCoins;
  return schedule.thirdPlaceCoins;
}

function playerDataMatchesSchedule(playerData, schedule) {
  return ["weekly", "monthly"].every((cycle) =>
    [1, 2, 3].every((rank) =>
      playerData?.[cycle]?.rewards?.find((reward) => reward.rank === rank)?.coins
        === expectedCoins(schedule[cycle], rank),
    ),
  );
}

function assertPlayerPanelsMatchFullAdminSchedule(playerData, schedule) {
  for (const cycle of ["weekly", "monthly"]) {
    const markup = renderRewardPanel(cycle, playerData[cycle]);
    assert.ok(markup.includes(`data-testid="leaderboard-rewards-${cycle}"`));
    assert.ok(markup.includes(cycle === "weekly" ? "WEEKLY PRIZES" : "MONTHLY PRIZES"));

    for (const rank of [1, 2, 3]) {
      const rowStart = markup.indexOf(`data-testid="leaderboard-reward-rank-${rank}"`);
      assert.notEqual(rowStart, -1, `${cycle} rank ${rank} should render.`);
      const rowEnd = markup.indexOf("</div>", rowStart);
      assert.notEqual(rowEnd, -1, `${cycle} rank ${rank} row should be complete.`);
      const rowMarkup = markup.slice(rowStart, rowEnd);
      const coins = expectedCoins(schedule[cycle], rank);
      assert.ok(rowMarkup.includes(`Rank #${rank}`));
      assert.ok(
        rowMarkup.includes(`${coins.toLocaleString("en-IN")} Coins`),
        `${cycle} rank ${rank} should match the Full Admin schedule.`,
      );
    }
  }
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("player prize panels follow Full Admin schedules after save, refresh, reopen, and restore", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const documentStub = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    document: documentStub,
  };
  globalThis.document = documentStub;

  let client;
  let focusManager;
  let stopPolling = () => {};
  let stopReopened = () => {};
  try {
    const queryLibrary = await import("@tanstack/react-query");
    const { QueryClient, QueryObserver } = queryLibrary;
    focusManager = queryLibrary.focusManager;
    focusManager.setFocused(true);

    assert.equal(LEADERBOARD_REFRESH_POLICY.refetchInterval, 30_000);
    assert.equal(LEADERBOARD_REFRESH_POLICY.refetchOnMount, "always");
    assert.match(
      leaderboardSource,
      /useDaily007ListLeaderboards\(\s*\{\s*query:\s*\{\s*queryKey:\s*getDaily007ListLeaderboardsQueryKey\(\),\s*\.\.\.LEADERBOARD_REFRESH_POLICY/s,
      "the player screen should apply the tested refresh policy to its query.",
    );
    assert.ok(leaderboardSource.includes("refetchLeaderboardOnFocus(query.refetch)"));

    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const baselineSchedule = {
      weekly: { firstPlaceCoins: 50, secondPlaceCoins: 40, thirdPlaceCoins: 30 },
      monthly: { firstPlaceCoins: 50, secondPlaceCoins: 40, thirdPlaceCoins: 30 },
    };
    const savedSchedule = {
      weekly: { firstPlaceCoins: 111, secondPlaceCoins: 222, thirdPlaceCoins: 333 },
      monthly: { firstPlaceCoins: 444, secondPlaceCoins: 555, thirdPlaceCoins: 666 },
    };
    const focusedSchedule = {
      weekly: { firstPlaceCoins: 131, secondPlaceCoins: 242, thirdPlaceCoins: 353 },
      monthly: { firstPlaceCoins: 464, secondPlaceCoins: 575, thirdPlaceCoins: 686 },
    };
    let developmentSchedule = structuredClone(baselineSchedule);
    const saveDevelopmentFullAdminFixture = ({ environment, role, data }) => {
      assert.equal(environment, "Development");
      assert.equal(role, "Full Admin");
      const cycles = Object.keys(data);
      assert.equal(cycles.length, 1, "the Full Admin screen saves one cycle at a time.");
      const cycle = cycles[0];
      assert.ok(cycle === "weekly" || cycle === "monthly");
      developmentSchedule = {
        ...developmentSchedule,
        [cycle]: structuredClone(data[cycle]),
      };
    };
    const saveSchedule = (schedule) => {
      saveDevelopmentFullAdminFixture({
        environment: "Development",
        role: "Full Admin",
        data: { weekly: schedule.weekly },
      });
      saveDevelopmentFullAdminFixture({
        environment: "Development",
        role: "Full Admin",
        data: { monthly: schedule.monthly },
      });
    };
    let reads = 0;
    const queryFn = async () => {
      reads += 1;
      return playerPeriodsFromFullAdminSchedule(developmentSchedule);
    };
    const baseOptions = {
      queryKey: ["leaderboard-refresh-regression"],
      queryFn,
      staleTime: 60_000,
      ...LEADERBOARD_REFRESH_POLICY,
    };

    // Use a short interval to exercise TanStack Query's real polling behavior
    // quickly; the production interval is asserted above and remains 30 seconds.
    const pollingObserver = new QueryObserver(client, {
      ...baseOptions,
      refetchInterval: 10,
    });
    stopPolling = pollingObserver.subscribe(() => {});
    await waitFor(
      () => reads >= 1 && pollingObserver.getCurrentResult().isSuccess,
      "The initial player leaderboard request did not complete.",
    );
    assertPlayerPanelsMatchFullAdminSchedule(
      pollingObserver.getCurrentResult().data,
      baselineSchedule,
    );

    saveSchedule(savedSchedule);
    await waitFor(
      () => reads >= 2 && playerDataMatchesSchedule(
        pollingObserver.getCurrentResult().data,
        savedSchedule,
      ),
      "The active player view did not receive the Full Admin save on its refresh interval.",
    );
    // The test shortens the timer; production still uses the asserted 30-second interval.
    assertPlayerPanelsMatchFullAdminSchedule(
      pollingObserver.getCurrentResult().data,
      savedSchedule,
    );
    stopPolling();

    const readsBeforeReopen = reads;
    const reopenedObserver = new QueryObserver(client, baseOptions);
    stopReopened = reopenedObserver.subscribe(() => {});
    await waitFor(
      () => reads > readsBeforeReopen &&
        playerDataMatchesSchedule(reopenedObserver.getCurrentResult().data, savedSchedule),
      "Reopening the player view did not request the latest Full Admin schedule.",
    );
    assertPlayerPanelsMatchFullAdminSchedule(
      reopenedObserver.getCurrentResult().data,
      savedSchedule,
    );

    const readsBeforeFocus = reads;
    saveSchedule(focusedSchedule);
    refetchLeaderboardOnFocus(() => reopenedObserver.refetch());
    await waitFor(
      () => reads > readsBeforeFocus &&
        playerDataMatchesSchedule(reopenedObserver.getCurrentResult().data, focusedSchedule),
      "Returning focus to the player view did not request the latest prize schedules.",
    );
    assertPlayerPanelsMatchFullAdminSchedule(
      reopenedObserver.getCurrentResult().data,
      focusedSchedule,
    );

    const readsBeforeRestore = reads;
    saveSchedule(baselineSchedule);
    refetchLeaderboardOnFocus(() => reopenedObserver.refetch());
    await waitFor(
      () => reads > readsBeforeRestore &&
        playerDataMatchesSchedule(reopenedObserver.getCurrentResult().data, baselineSchedule),
      "The player panels did not show the restored Full Admin schedule.",
    );
    assertPlayerPanelsMatchFullAdminSchedule(
      reopenedObserver.getCurrentResult().data,
      baselineSchedule,
    );
  } finally {
    stopPolling();
    stopReopened();
    client?.clear();
    focusManager?.setFocused(undefined);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});