import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
  assert.match(flow, /times: 12[\s\S]*?id: leaderboard-native-text-scale-fixture-banner/);
  assert.match(flow, /id: leaderboard-native-text-scale-fixture-banner\n\s+timeout: 60000/);
  assert.match(flow, /\$\{LEADERBOARD_SCALE\}/);
  assert.match(flow, /\$\{LEADERBOARD_LAYOUT\}/);
  assert.match(
    flow,
    /id: leaderboard-top20-toggle\n\s+direction: DOWN\n\s+centerElement: true[\s\S]*?- swipe:\n\s+start: 50%, 75%\n\s+end: 50%, 30%\n\s+duration: 450[\s\S]*?- tapOn:\s*\n\s+id: leaderboard-top20-toggle/,
  );
  assert.match(flow, /text: "HIDE TOP 20 PLAYERS"/);
  assert.match(leaderboardScreen, /nativeTestFixture \? styles\.nativeTextScaleFixtureContent/);
  assert.match(leaderboardScreen, /nativeTextScaleFixtureContent:\s*\{\s*paddingBottom:\s*220\s*\}/);
  assert.match(
    flow,
    /id: leaderboard-player-8[\s\S]*?text: "Rank 8, Tournament Competitor 8, 14,152 coins"[\s\S]*?id: leaderboard-player-9/,
  );
  assert.doesNotMatch(flow, /end: 50%, 69%\n\s+duration: 350/);

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
    if (rank === 4) {
      assert.ok(
        flow.includes(`id: ${rowId}\n    direction: DOWN\n    visibilityPercentage: 100`),
        "Rank 4 must be fully visible without a centering scroll",
      );
    } else {
      assert.ok(
        flow.includes(`id: ${rowId}\n    direction: DOWN\n    centerElement: true`),
        `Rank ${rank} must be centered before checking its label`,
      );
    }
    assert.ok(flow.includes(`text: "${label}"`), `Missing full rank/name/score assertion for rank ${rank}`);
  }
});

test("runner checks compact edge, layout boundary, and 2× scales and restores the original Android setting", () => {
  assert.match(runner, /setting: "1\.49", label: "1\.49", layout: "compact"/);
  assert.match(runner, /setting: "1\.5", label: "1\.50", layout: "large"/);
  assert.match(runner, /setting: "2", label: "2\.00", layout: "large"/);
  assert.match(runner, /name: "weekly"/);
  assert.match(runner, /name: "monthly"/);
  assert.match(runner, /for \(const scale of scales\)[\s\S]*?for \(const cycle of cycles\)/);
  assert.match(runner, /for \(const scale of scales\)[\s\S]*?for \(const cycle of cycles\)[\s\S]*?maestroArgs\.push\(flowPath\)/);
  assert.match(runner, /maestroArgs\.push\("-e", `\$\{name\}=\$\{value\}`\)/);
  assert.match(runner, /LEADERBOARD_SCALE: scale\.label/);
  assert.match(runner, /LEADERBOARD_CYCLE: cycle\.name/);
  assert.match(runner, /finally\s*\{[\s\S]*?settings[\s\S]*?originalFontScale/);
  assert.match(runner, /Could not verify restoration of Android font scale/);
  assert.match(runner, /Android font scale was not restored/);
});

test("runner restores the original Android setting when a Maestro flow fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "leaderboard-text-scale-"));
  const statePath = join(directory, "font-scale");
  const adbLogPath = join(directory, "adb.log");
  const maestroArgsLogPath = join(directory, "maestro-args.log");
  const adbPath = join(directory, "adb");
  const maestroPath = join(directory, "maestro");
  const runnerPath = fromDaily007("scripts/run-android-leaderboard-large-text.mjs");

  try {
    await writeFile(statePath, "1.0");
    await writeFile(adbPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$ADB_LOG"
case "$*" in
  "devices -l")
    printf 'emulator-5554 device product:stub model:stub\\n'
    ;;
  "shell pm path host.exp.exponent")
    printf 'package:/data/app/host.exp.exponent/base.apk\\n'
    ;;
  "shell settings get system font_scale")
    cat "$FONT_SCALE_STATE"
    ;;
  "shell settings put system font_scale "*)
    printf '%s' "$6" > "$FONT_SCALE_STATE"
    ;;
  "shell am force-stop host.exp.exponent")
    ;;
  *)
    printf 'Unexpected adb command: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`);
    await writeFile(maestroPath, `#!/bin/sh
printf '%s\\n' "$@" > "$MAESTRO_ARGS_LOG"
printf 'simulated Maestro failure\\n' >&2
exit 1
`);
    await Promise.all([chmod(adbPath, 0o755), chmod(maestroPath, 0o755)]);

    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        ADB_LOG: adbLogPath,
        MAESTRO_ARGS_LOG: maestroArgsLogPath,
        FONT_SCALE_STATE: statePath,
        EXPO_DEV_URL: "exp://127.0.0.1:8081",
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(await readFile(statePath, "utf8"), "1.0");
    const adbLog = await readFile(adbLogPath, "utf8");
    const maestroArgs = (await readFile(maestroArgsLogPath, "utf8")).split(/\r?\n/);
    assert.match(adbLog, /settings put system font_scale 1\.49/);
    assert.match(adbLog, /settings put system font_scale 1\.0/);
    assert.ok(maestroArgs.includes("LEADERBOARD_CYCLE=weekly"));
    assert.ok(maestroArgs.includes("LEADERBOARD_CHAMPION=Weekly Champion With A Long Display Name"));
    assert.ok(maestroArgs.includes("LEADERBOARD_SCALE=1.49"));
    assert.ok(maestroArgs.includes("LEADERBOARD_LAYOUT=compact"));
    assert.ok(maestroArgs.includes("maestro/leaderboard-native-text-scale/large-text.yaml"));
    assert.match(result.stderr, /simulated Maestro failure/);
    assert.match(result.stdout, /Restored Android font scale to 1\.0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
