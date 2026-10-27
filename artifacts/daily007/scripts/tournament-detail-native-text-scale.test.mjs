import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const [
  flow,
  localizedFlow,
  fixture,
  detailScreen,
  runner,
  packageJson,
  hindi,
  gujarati,
  roomPanel,
] = await Promise.all([
  readFile(fromDaily007('maestro/tournament-detail-native-text-scale/large-text.yaml'), 'utf8'),
  readFile(fromDaily007('maestro/tournament-detail-native-text-scale/localized-large-text.yaml'), 'utf8'),
  readFile(fromDaily007('src/screens/TournamentDetailNativeTextScaleTest.tsx'), 'utf8'),
  readFile(fromDaily007('src/screens/TDetail.tsx'), 'utf8'),
  readFile(fromDaily007('scripts/run-android-tournament-detail-large-text.mjs'), 'utf8'),
  readFile(fromDaily007('package.json'), 'utf8'),
  readFile(fromDaily007('src/i18n/locales/hi.ts'), 'utf8'),
  readFile(fromDaily007('src/i18n/locales/gu.ts'), 'utf8'),
  readFile(fromDaily007('src/components/RoomCredentialsPanel.tsx'), 'utf8'),
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

test('Hindi and Gujarati Android flows cover registered squad details and released room credentials', () => {
  for (const selector of [
    'tournament-detail-language-${TOURNAMENT_DETAIL_TEXT_LANGUAGE}',
    'tournament-detail-open-team',
    'squad-registration-status',
    'squad-capacity-summary',
    'squad-team-01-joined-count',
    'room-credentials-title',
    'room-credential-value-room-id',
    'room-credential-value-password',
    'room-credential-copy-room-id',
    'room-credential-copy-password',
    'squad-slots-row',
  ]) {
    assert.ok(localizedFlow.includes(selector), `Missing localized detail check: ${selector}`);
  }
  assert.match(runner, /const scales = \['1\.5', '2'\]/);
  assert.match(runner, /language: 'hi'/);
  assert.match(runner, /language: 'gu'/);
  assert.match(runner, /localizedFlowPath/);
  assert.match(runner, /screenWidthDp > 400/);
  assert.match(fixture, /testID=\{`tournament-detail-language-\$\{value\}`\}/);
  assert.match(fixture, /testID=\{`tournament-detail-language-state-\$\{language\}`\}/);
  assert.match(fixture, /कप्तान अमन कुमार का बहुत लंबा Free Fire खिलाड़ी नाम/);
  assert.match(fixture, /કેપ્ટન રાજવીર પટેલનું ખૂબ લાંબું Free Fire નામ/);
  assert.match(roomPanel, /accessibilityLabel=\{translateExactText\(`Copy \$\{label\}`\)\}/);
  assert.match(detailScreen, /translateExactText\([\s\S]*?PLAYERS ·[\s\S]*?TEAMS/);
  assert.match(detailScreen, /translateExactText\([\s\S]*?Your registration: Team/);
  assert.match(detailScreen, /height: 'auto', minHeight: 92/);
  assert.doesNotMatch(
    detailScreen.match(/<Text\s+style=\{slotIsOccupied \? s\.squadSlotName : s\.squadSlotOpen\}[\s\S]*?<\/Text>/)?.[0] ?? '',
    /numberOfLines=/,
  );
  for (const locale of [hindi, gujarati]) {
    for (const key of [
      '{{filledPlayers}}/{{totalPlayers}} PLAYERS · {{filledTeams}}/{{totalTeams}} TEAMS',
      '{{joinedCount}}/{{teamSize}} JOINED',
      '{{joinedCount}} of {{teamSize}} players joined',
      'Your registration: Team {{teamNumber}}, slot {{slotNumber}}.',
      'Room ID: {{value}}',
      'Password: {{value}}',
      'Copy Room ID',
      'Copy Password',
    ]) {
      assert.ok(locale.includes(`"${key}"`), `Missing localized detail string: ${key}`);
    }
  }
});

test('large text gives tournament detail statistics their own readable rows', () => {
  assert.match(detailScreen, /const \{ width: detailWidth, fontScale: detailFontScale \} = useWindowDimensions\(\)/);
  assert.match(detailScreen, /detailLargeText && s\.statRowLarge/);
  assert.match(detailScreen, /detailLargeText && s\.statLarge/);
  assert.match(detailScreen, /detailLargeText \? s\.statLarge : s\.statDivider/);
  assert.match(detailScreen, /stackedDetailHeader && s\.heroRowStacked/);
  assert.match(detailScreen, /compactLargeText && s\.squadSlotColumnCompact/);
});

async function runRunnerWithStubs({ maestroExitCode = 0, displaySize = '1080x2400', density = 480 } = {}) {
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
  "shell wm size")
    printf 'Physical size: %s\\n' "$DISPLAY_SIZE"
    ;;
  "shell wm density")
    printf 'Physical density: %s\\n' "$DISPLAY_DENSITY"
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
printf '%s:%s\\n' "$TOURNAMENT_DETAIL_TEXT_SCALE" "$TOURNAMENT_DETAIL_TEXT_LANGUAGE" >> "$MAESTRO_LOG"
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
      DISPLAY_SIZE: displaySize,
      DISPLAY_DENSITY: String(density),
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
  assert.equal(maestroLog, '1.50:en\n1.50:hi\n1.50:gu\n2.00:en\n2.00:hi\n2.00:gu\n');
  assert.equal(state, '1.0');
});

test('the Android runner refuses wide layouts so it exercises the narrow-phone grid', async () => {
  const { result, maestroLog } = await runRunnerWithStubs({
    displaySize: '1440x3200',
    density: 480,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a narrow Android phone/);
  assert.equal(maestroLog, '');
});

test('the Android runner restores the setting after a Maestro failure', async () => {
  const { result, state } = await runRunnerWithStubs({ maestroExitCode: 1 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Maestro failed for tournament details in en at 1\.50×/);
  assert.equal(state, '1.0');
});
