import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [flow, fixture, detailScreen, runner, packageJson] = await Promise.all([
  readFile(fromDaily007('maestro/tournament-detail-native-text-scale/large-text.yaml'), 'utf8'),
  readFile(fromDaily007('src/screens/TournamentDetailNativeTextScaleTest.tsx'), 'utf8'),
  readFile(fromDaily007('src/screens/TDetail.tsx'), 'utf8'),
  readFile(fromDaily007('scripts/run-android-tournament-detail-large-text.mjs'), 'utf8'),
  readFile(fromDaily007('package.json'), 'utf8'),
]);

test('the native fixture mounts the real tournament detail screen with local solo and team data', () => {
  assert.match(fixture, /<Stack\.Screen name="TDetail" component=\{TDetail\} \/>/);
  assert.match(fixture, /<Stack\.Screen name="JoinForm" component=\{JoinFormFixture\} \/>/);
  assert.match(fixture, /large-text-solo-detail/);
  assert.match(fixture, /large-text-team-detail/);
  assert.match(fixture, /globalThis\.fetch = fixtureFetch/);
  assert.match(fixture, /Api as any\)\.tournament/);
  assert.match(fixture, /Api as any\)\.myRegistrations/);
  assert.match(fixture, /DETAIL-ROOM-0123456789/);
  assert.match(fixture, /DETAIL-PASSWORD-0123456789/);
  assert.match(fixture, /globalThis\.fetch = originalFetch/);
  assert.match(fixture, /Api\.tournament = originalApi\.tournament/);
  assert.match(fixture, /Api\.myRegistrations = originalApi\.myRegistrations/);
});

test('Maestro checks solo join, team slot and registration information, and room credential copy', () => {
  for (const selector of [
    'tournament-detail-open-solo',
    'tournament-detail-open-team-join',
    'tournament-detail-open-team',
    'tournament-detail-stats',
    'mode-seat-large-text-solo-detail-1-1',
    'mode-seat-join-1-1',
    'tournament-detail-join',
    'room-credential-value-room-id',
    'room-credential-value-password',
    'room-credential-copy-room-id',
    'squad-slots-row',
    'squad-slot-1-3',
    'squad-join-select-01-3',
    'squad-game-name',
    'squad-game-uid',
    'squad-join-confirm',
    'squad-registration-status',
  ]) {
    assert.ok(flow.includes(selector), `Missing native detail check: ${selector}`);
  }
  assert.match(runner, /const scales = \['1\.5', '2'\]/);
  assert.match(flow, /Solo Tournament Detail Large Text Check/);
  assert.match(flow, /Team Tournament Detail Large Text Check/);
  assert.match(flow, /Joinable Squad Team Detail Large Text Check/);
  assert.match(flow, /Captain Player/);
  assert.match(flow, /Second Team Player/);
  assert.match(flow, /Room ID copied to clipboard\./);
  assert.match(flow, /Join action opened/);
  assert.match(fixture, /tournament-detail-join-form-fixture/);
  assert.match(detailScreen, /testID="tournament-detail-hero"/);
  assert.match(detailScreen, /testID="tournament-detail-join"/);
  assert.match(detailScreen, /testID="squad-registration-status"/);
  assert.match(packageJson, /"test:android-tournament-detail-large-text":\s*"node scripts\/run-android-tournament-detail-large-text\.mjs"/);
});

test('large text gives tournament detail statistics their own readable rows', () => {
  assert.match(detailScreen, /const \{ width: detailWidth, fontScale: detailFontScale \} = useWindowDimensions\(\)/);
  assert.match(detailScreen, /detailLargeText && s\.statRowLarge/);
  assert.match(detailScreen, /detailLargeText && s\.statLarge/);
  assert.match(detailScreen, /detailLargeText \? s\.statLarge : s\.statDivider/);
  assert.match(detailScreen, /stackedDetailHeader && s\.heroRowStacked/);
  assert.match(detailScreen, /compactLargeText && s\.squadSlotColumnCompact/);
});

async function runRunnerWithStubs({ maestroExitCode = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tournament-detail-text-scale-'));
  const statePath = join(directory, 'font-scale');
  const adbLogPath = join(directory, 'adb.log');
  const maestroLogPath = join(directory, 'maestro.log');
  const adbPath = join(directory, 'adb');
  const maestroPath = join(directory, 'maestro');
  const runnerPath = fromDaily007('scripts/run-android-tournament-detail-large-text.mjs');

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
printf '%s\\n' "$TOURNAMENT_DETAIL_TEXT_SCALE" >> "$MAESTRO_LOG"
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
    // Maestro is skipped if Android setup checks fail.
  }
  await rm(directory, { recursive: true, force: true });
  return { result, state, maestroLog };
}

test('the Android runner checks both scales and restores the original setting', async () => {
  const { result, state, maestroLog } = await runRunnerWithStubs();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(maestroLog, '1.50\n2.00\n');
  assert.equal(state, '1.0');
});

test('the Android runner restores the setting after a Maestro failure', async () => {
  const { result, state } = await runRunnerWithStubs({ maestroExitCode: 1 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Maestro failed for tournament details at 1\.50×/);
  assert.equal(state, '1.0');
});
