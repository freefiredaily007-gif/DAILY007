import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [flow, runner, fixture, route, home, cards] = await Promise.all([
  readFile(fromDaily007("maestro/home-mode-native-text-scale/large-text.yaml"), "utf8"),
  readFile(fromDaily007("scripts/run-android-home-mode-large-text.mjs"), "utf8"),
  readFile(fromDaily007("src/screens/HomeGameModeNativeTextScaleTest.tsx"), "utf8"),
  readFile(fromDaily007("app/home-mode-native-text-scale-test.tsx"), "utf8"),
  readFile(fromDaily007("src/screens/Home.tsx"), "utf8"),
  readFile(fromDaily007("src/screens/HomeGameModeCards.tsx"), "utf8"),
]);

test("native route renders the shared Home game-mode cards with deterministic destinations", () => {
  assert.match(fixture, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(fixture, /<HomeGameModeCards/);
  assert.match(fixture, /onOpenMode=\{setSelectedMode\}/);
  assert.match(fixture, /Game mode filter: \{selectedMode\.gameMode\}/);
  assert.match(route, /HomeGameModeNativeTextScaleTest/);
  assert.match(cards, /export default function HomeGameModeCards/);
  assert.match(home, /onOpenMode=\{\(params\) => nav\.navigate\('Tournaments', params\)\}/);
});

test("Maestro scrolls to each Home mode card, checks its action, and verifies the route filter", () => {
  for (const [id, title, mode] of [
    ["battle-royale", "BATTLE ROYALE", "battle_royale"],
    ["clash-squad", "CLASH SQUAD", "clash_squad"],
    ["lone-wolf", "LONE WOLF", "lone_wolf"],
  ]) {
    assert.ok(flow.includes(`id: home-mode-${id}`), `Missing scroll/tap target for ${title}`);
    assert.ok(flow.includes(`text: "${title}"`), `Missing title assertion for ${title}`);
    assert.ok(flow.includes('text: "BROWSE TOURNAMENTS"'), `Missing Browse Tournaments assertion for ${title}`);
    assert.ok(flow.includes(`text: "Game mode filter: ${mode}"`), `Missing destination filter check for ${title}`);
  }
  assert.match(flow, /font scale 1\.50/);
});

test("Android runner restores the original font scale from a finally block", () => {
  assert.match(runner, /settings",\s*"put",\s*"system",\s*"font_scale",\s*"1\.5"/);
  assert.match(runner, /finally\s*\{[\s\S]*?font_scale[\s\S]*?originalFontScale/);
  assert.match(runner, /Could not verify restoration of Android font scale/);
  assert.match(runner, /Android font scale was not restored/);
});

test("Android runner restores the original font scale when Maestro fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "home-mode-text-scale-"));
  const statePath = join(directory, "font-scale");
  const adbPath = join(directory, "adb");
  const maestroPath = join(directory, "maestro");

  try {
    await writeFile(statePath, "1.0");
    await writeFile(adbPath, `#!/bin/sh
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
printf 'simulated Maestro failure\\n' >&2
exit 7
`);
    await chmod(adbPath, 0o755);
    await chmod(maestroPath, 0o755);

    const result = spawnSync(
      process.execPath,
      [fromDaily007("scripts/run-android-home-mode-large-text.mjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          EXPO_DEV_URL: "http://127.0.0.1:8081",
          FONT_SCALE_STATE: statePath,
          PATH: `${directory}:${process.env.PATH}`,
        },
      },
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Maestro failed/);
    assert.equal(await readFile(statePath, "utf8"), "1.0");
    assert.match(result.stdout, /Restored Android font scale to 1\.0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
