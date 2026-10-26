import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [flow, runner, fixture, modeFilters, packageJson] = await Promise.all([
  readFile(fromDaily007('maestro/tournament-native-text-scale/large-text.yaml'), 'utf8'),
  readFile(fromDaily007('scripts/run-android-tournament-large-text.mjs'), 'utf8'),
  readFile(fromDaily007('src/screens/TournamentNativeTextScaleTest.tsx'), 'utf8'),
  readFile(fromDaily007('src/components/TournamentModeFilters.tsx'), 'utf8'),
  readFile(fromDaily007('package.json'), 'utf8'),
]);

test('the native fixture reuses real tournament cards, filters, progress, and released room details', () => {
  assert.match(fixture, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(fixture, /<TournamentModeFilters[\s\S]*?filters=\{GAME_MODE_FILTERS\}/);
  assert.match(fixture, /<MatchCard[\s\S]*?variant="browse"[\s\S]*?testID=\{`tournament-card-/);
  assert.match(fixture, /<RoomCredentialsPanel[\s\S]*?configured=\{tournament\.myRegistration\?\.roomPublished === true\}/);
  assert.match(fixture, /ROOM-DETAILS-TEST-ID-0123456789/);
  assert.match(fixture, /TEST-PASSWORD-0123456789/);
  assert.match(fixture, /x \+ bounds\.width <= filterContainerWidth \+ 1/);
  assert.match(modeFilters, /accessibilityState=\{\{ selected \}\}/);
  assert.match(modeFilters, /testID=\{`tournament-mode-tab-\$\{filter\.key\}`\}/);
  assert.match(modeFilters, /flexWrap: 'wrap'/);
});

test('Maestro checks every mode, long card details, actions, and room credentials', () => {
  for (const key of ['all', 'battle_royale_kill_earn', 'battle_royale', 'clash_squad', 'lone_wolf']) {
    assert.ok(flow.includes(`id: tournament-mode-tab-${key}`), `Missing mode selector: ${key}`);
    assert.ok(flow.includes(`Selected tournament mode: ${key}`), `Missing selected-mode assertion: ${key}`);
  }
  for (const cardId of [
    'text-scale-kill-earn',
    'text-scale-br-classic',
    'text-scale-clash-squad',
    'text-scale-lone-wolf',
  ]) {
    assert.ok(flow.includes(`id: tournament-card-${cardId}`), `Missing card action check: ${cardId}`);
    assert.ok(flow.includes(`Opened tournament card: ${cardId}`), `Missing opened-card assertion: ${cardId}`);
    for (const area of ['name', 'date', 'metric-prize-pool', 'metric-per-kill', 'metric-entry', 'progress-count', 'progress-spots', 'join']) {
      assert.ok(flow.includes(`id: tournament-card-${cardId}-${area}`), `Missing card layout check for ${cardId} ${area}`);
    }
  }
  assert.match(flow, /Tournament card fixture \| font scale \$\{TOURNAMENT_TEXT_SCALE\} \| large/);
  assert.match(flow, /Tournament filters fit screen width at \$\{TOURNAMENT_TEXT_SCALE\}x/);
  assert.match(flow, /28 OCT 2027/);
  assert.match(flow, /PRIZE POOL/);
  assert.match(flow, /PER KILL/);
  assert.match(flow, /ENTRY/);
  assert.match(flow, /16\/48 JOINED/);
  assert.match(flow, /32 SPOTS LEFT/);
  assert.match(flow, /JOIN TOURNAMENT/);
  assert.match(flow, /Room ID: ROOM-DETAILS-TEST-ID-0123456789/);
  assert.match(flow, /Room ID copied to clipboard\./);
  assert.match(packageJson, /"test:android-tournament-large-text":\s*"node scripts\/run-android-tournament-large-text\.mjs"/);
});

async function runRunnerWithStubs({ maestroExitCode = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tournament-text-scale-'));
  const statePath = join(directory, 'font-scale');
  const adbLogPath = join(directory, 'adb.log');
  const maestroLogPath = join(directory, 'maestro.log');
  const adbPath = join(directory, 'adb');
  const maestroPath = join(directory, 'maestro');
  const runnerPath = fromDaily007('scripts/run-android-tournament-large-text.mjs');

  await writeFile(statePath, '1.0');
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
printf '%s\\n' "$TOURNAMENT_TEXT_SCALE" >> "$MAESTRO_LOG"
exit ${maestroExitCode}
`);
  await Promise.all([chmod(adbPath, 0o755), chmod(maestroPath, 0o755)]);

  const result = spawnSync(process.execPath, [runnerPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      ADB_LOG: adbLogPath,
      FONT_SCALE_STATE: statePath,
      MAESTRO_LOG: maestroLogPath,
      EXPO_DEV_URL: 'exp://127.0.0.1:8081',
    },
  });

  const state = await readFile(statePath, 'utf8');
  let maestroLog = '';
  try {
    maestroLog = await readFile(maestroLogPath, 'utf8');
  } catch {
    // Maestro may not run if the first Android setup check fails.
  }
  await rm(directory, { recursive: true, force: true });
  return { result, state, maestroLog };
}

test('the Android runner executes both scales and restores the original setting', async () => {
  const { result, state, maestroLog } = await runRunnerWithStubs();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(maestroLog, '1.50\n2.00\n');
  assert.equal(state, '1.0');
});

test('the Android runner restores the original setting after a Maestro failure', async () => {
  const { result, state } = await runRunnerWithStubs({ maestroExitCode: 1 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Maestro failed for tournament cards at 1\.50×/);
  assert.equal(state, '1.0');
});
