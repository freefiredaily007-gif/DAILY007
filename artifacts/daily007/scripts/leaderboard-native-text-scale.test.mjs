import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [flow, runner, fixture, testScreen, leaderboardScreen] = await Promise.all([
  readFile(fromDaily007("maestro/leaderboard-native-text-scale/large-text.yaml"), "utf8"),
  readFile(fromDaily007("scripts/run-android-leaderboard-large-text.mjs"), "utf8"),
  readFile(fromDaily007("src/lib/leaderboardTextScaleFixture.ts"), "utf8"),
  readFile(fromDaily007("src/screens/LeaderboardNativeTextScaleTest.tsx"), "utf8"),
  readFile(fromDaily007("src/screens/LeaderboardDetails.tsx"), "utf8"),
]);

function expectedName(rank, cycle) {
  if (rank === 1) return `${cycle === "weekly" ? "Weekly" : "Monthly"} Champion With A Long Display Name`;
  if (rank === 4) return "International Tournament Competitor With A Player Name That Wraps Across Multiple Lines";
  if (rank === 20) return "Rank Twenty Final Player";
  return `Tournament Competitor ${rank}`;
}

function expectedScore(rank) {
  return (rank === 20 ? 1_234_567 : 20_000 - rank * 731).toLocaleString("en-IN");
}

test("native route uses the deterministic 20-player fixture without leaderboard requests", () => {
  assert.match(fixture, /Array\.from\(\{ length: 20 \}/);
  assert.match(fixture, /rank === 20 \? 1_234_567/);
  assert.match(testScreen, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(testScreen, /__nativeLeaderboardTestFixture: LEADERBOARD_TEXT_SCALE_FIXTURE/);
  assert.match(
    leaderboardScreen,
    /if \(nativeTestFixture\) \{[\s\S]*?data: nativeTestFixture[\s\S]*?return <LiveLeaderboardDetails/,
  );
  assert.match(leaderboardScreen, /function LiveLeaderboardDetails[\s\S]*?useDaily007ListLeaderboards/);
});

test("Maestro scrolls to and checks every podium and expanded Top 20 label", () => {
  assert.match(flow, /leaderboard-native-text-scale-\$\{LEADERBOARD_CYCLE\}/);
  assert.match(flow, /\$\{LEADERBOARD_SCALE\}/);
  assert.match(flow, /\$\{LEADERBOARD_LAYOUT\}/);
  assert.match(flow, /id: leaderboard-top20-toggle[\s\S]*?- tapOn:\s*\n\s+id: leaderboard-top20-toggle/);

  for (const rank of [1, 2, 3]) {
    assert.ok(flow.includes(`id: leaderboard-podium-${rank}`), `Missing scroll target for podium rank ${rank}`);
    for (const cycle of ["weekly", "monthly"]) {
      const name = rank === 1 ? "${LEADERBOARD_CHAMPION}" : expectedName(rank, cycle);
      const label = `Rank ${rank}, ${name}, ${expectedScore(rank)} coins`;
      assert.ok(flow.includes(`text: "${label}"`), `Missing podium label: ${label}`);
    }
  }

  for (let rank = 4; rank <= 20; rank += 1) {
    const rowId = `leaderboard-player-${rank}`;
    const label = `Rank ${rank}, ${expectedName(rank, "weekly")}, ${expectedScore(rank)} coins`;
    assert.ok(flow.includes(`id: ${rowId}`), `Missing scroll target for rank ${rank}`);
    assert.ok(flow.includes(`text: "${label}"`), `Missing full rank/name/score assertion for rank ${rank}`);
  }
});

test("runner checks boundary and 2× scales and restores the original Android setting", () => {
  assert.match(runner, /setting: "1\.49"/);
  assert.match(runner, /setting: "1\.5"/);
  assert.match(runner, /setting: "2", label: "2\.00", layout: "large"/);
  assert.match(runner, /name: "weekly"/);
  assert.match(runner, /name: "monthly"/);
  assert.match(runner, /for \(const scale of scales\)[\s\S]*?for \(const cycle of cycles\)/);
  assert.match(runner, /LEADERBOARD_SCALE: scale\.label/);
  assert.match(runner, /LEADERBOARD_CYCLE: cycle\.name/);
  assert.match(runner, /finally\s*\{[\s\S]*?settings[\s\S]*?originalFontScale/);
  assert.match(runner, /Could not verify restoration of Android font scale/);
  assert.match(runner, /Android font scale was not restored/);
});
