import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  leaderboardPlayerAccessibilityLabel,
  leaderboardPodiumAccessibilityLabel,
  selectLeaderboardExpandedRows,
  selectLeaderboardTopTwenty,
} from "../src/lib/leaderboardStandings.ts";

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

  const cycleTabs = screenSource.slice(tabsStart, tabsEnd);
  assert.match(cycleTabs, /accessibilityRole="tab"/);
  assert.match(cycleTabs, /accessibilityState=\{\{ selected \}\}/);
  assert.match(
    cycleTabs,
    /accessibilityLabel=\{key === "weekly" \? "Weekly leaderboard" : "Monthly leaderboard"\}/,
  );
  assert.match(cycleTabs, /testID=\{`leaderboard-details-tab-\$\{key\}`\}/);
  assert.match(cycleTabs, /const selected = cycle === key;/);

  const selectedCycleOnRoute = screenSource.match(
    /const cycle: CycleType = route\?\.params\?\.cycleType === "monthly" \? "monthly" : "weekly";/,
  );
  assert.ok(selectedCycleOnRoute, "The selected tab must follow the currently displayed cycle.");

  const onPress = cycleTabs.match(/onPress=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(onPress, "Each tab must have a cycle-switching handler.");
  assert.match(onPress[1], /setShowTop20\(false\);/);
  assert.match(onPress[1], /navigation\.setParams\(\{ cycleType: key \}\);/);
});

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

    assert.deepEqual(topTwenty.map((standing) => standing.rank), expectedTopTwentyRanks);
    assert.deepEqual(expandedRows.map((standing) => standing.rank), expectedExpandedRanks);
  });
}

test("the screen selects the active Weekly or Monthly period before ranking its entries", () => {
  assert.match(
    screenSource,
    /const cycle: CycleType = route\?\.params\?\.cycleType === "monthly" \? "monthly" : "weekly";/,
  );
  assert.match(screenSource, /const period = data\?\.\[cycle\];/);
  assert.match(screenSource, /const standings = selectLeaderboardTopTwenty\(period\?\.standings\);/);
  assert.match(screenSource, /const remainingPlayers = selectLeaderboardExpandedRows\(standings\);/);
});