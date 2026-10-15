import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [flow, screen, fixtureRoute, packageJson, workflow] = await Promise.all([
  readFile(fromDaily007("maestro/leaderboard-tabs/weekly-monthly.yaml"), "utf8"),
  readFile(fromDaily007("src/screens/LeaderboardDetails.tsx"), "utf8"),
  readFile(fromDaily007("src/screens/LeaderboardNativeTextScaleTest.tsx"), "utf8"),
  readFile(fromDaily007("package.json"), "utf8"),
  readFile(new URL("../../../.github/scripts/android-emulator-verification.sh", import.meta.url), "utf8"),
]);

test("Maestro checks both native leaderboard tabs, their selection, and matching standings", () => {
  assert.match(flow, /leaderboard-native-text-scale-weekly/);
  for (const cycle of ["weekly", "monthly"]) {
    assert.match(
      flow,
      new RegExp(`id: leaderboard-details-tab-${cycle}[\\s\\S]*?text: ${cycle === "weekly" ? "Weekly" : "Monthly"} leaderboard[\\s\\S]*?selected: (?:true|false)`),
    );
    assert.ok(flow.includes(`Rank 1, ${cycle === "weekly" ? "Weekly" : "Monthly"} Champion With A Long Display Name, 19,269 coins`));
    assert.ok(screen.includes(`accessibilityLabel={key === "weekly" ? "Weekly leaderboard" : "Monthly leaderboard"}`));
    assert.ok(screen.includes(`testID={\`leaderboard-details-tab-\${key}\`}`));
  }

  assert.match(flow, /tapOn:[\s\S]*?id: leaderboard-details-tab-monthly[\s\S]*?Monthly leaderboard/);
  assert.match(flow, /tapOn:[\s\S]*?id: leaderboard-details-tab-weekly[\s\S]*?Weekly leaderboard/);
  assert.match(screen, /accessibilityRole="tab"/);
  assert.match(screen, /accessibilityState=\{\{ selected \}\}/);
  assert.match(screen, /const period = data\?\.\[cycle\];/);
  assert.match(fixtureRoute, /__nativeLeaderboardTestFixture: LEADERBOARD_TEXT_SCALE_FIXTURE/);
});

test("Android release workflow runs the leaderboard tab flow with Maestro", () => {
  assert.match(packageJson, /"test:android-leaderboard-tabs":\s*"maestro test/);
  assert.match(workflow, /run_maestro_suite leaderboard-tabs test:android-leaderboard-tabs/);
});
