import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const fromDaily007 = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFile(fromDaily007(path), 'utf8');

test('Home, Wallet, and Profile Maestro flows verify 2× text, full-width content, and reachable actions', async () => {
  const [
    homeFlow,
    walletFlow,
    profileFlow,
    homeFixture,
    walletFixture,
    profileFixture,
    homeRoute,
    walletRoute,
    profileRoute,
  ] = await Promise.all([
    read('maestro/home-mode-native-text-scale/large-text-2x.yaml'),
    read('maestro/wallet-native-text-scale/large-text.yaml'),
    read('maestro/profile-native-text-scale/large-text.yaml'),
    read('src/screens/HomeGameModeNativeTextScaleTest.tsx'),
    read('src/screens/WalletTextScaleNativeTest.tsx'),
    read('src/screens/ProfileTextScaleNativeTest.tsx'),
    read('app/home-mode-native-text-scale-test.tsx'),
    read('app/wallet-text-scale-test.tsx'),
    read('app/profile-text-scale-test.tsx'),
  ]);

  assert.match(homeRoute, /HomeGameModeNativeTextScaleTest/);
  assert.match(walletRoute, /WalletTextScaleNativeTest/);
  assert.match(profileRoute, /ProfileTextScaleNativeTest/);
  assert.match(homeFlow, /home-mode-native-text-scale-test/);
  assert.match(homeFlow, /font scale 2\.00/);
  assert.match(homeFlow, /Home labels fit their available width at 2×/);
  for (const mode of ['battle-royale', 'clash-squad', 'lone-wolf']) {
    assert.match(homeFlow, new RegExp(`id: home-mode-${mode}`));
  }
  assert.equal((homeFlow.match(/centerElement: true/g) ?? []).length, 4);
  assert.match(homeFixture, /paddingBottom: 1200/);
  assert.doesNotMatch(homeFlow, /text: "BROWSE TOURNAMENTS"/);
  assert.match(homeFixture, /<HomeGameModeCards/);
  assert.match(homeFixture, /nativeTextScaleLayoutsFit/);
  assert.match(homeFixture, /onTextScaleLayout=/);

  assert.match(walletFlow, /wallet-text-scale-test/);
  assert.match(walletFlow, /Wallet key text fits available widths at 2\.00×/);
  assert.match(walletFlow, /id: wallet-open-recharge\n\s+enabled: true/);
  assert.match(walletFlow, /id: wallet-utr/);
  assert.doesNotMatch(walletFlow, /wallet-transaction-id/);
  for (const control of ['wallet-open-recharge', 'wallet-open-withdraw', 'wallet-history-filter-withdrawals']) {
    assert.match(walletFlow, new RegExp(`id: ${control}`));
  }
  assert.match(walletFixture, /withdrawalEnabled: true/);
  assert.match(walletFixture, /historyTestApi=\{historyTestApi\}/);
  assert.match(walletFixture, /initialTestSettings=\{walletTestSettings\}/);
  assert.match(walletFixture, /rechargeEnabled: true/);
  assert.match(walletFixture, /nativeTextScaleLayoutsFit/);
  assert.match(walletFixture, /wallet:action:add/);
  assert.match(walletFixture, /wallet:action:withdraw/);

  assert.match(profileFlow, /profile-text-scale-test/);
  assert.match(profileFlow, /Profile key text fits available widths at 2\.00×/);
  assert.match(profileFlow, /element:\n\s+text: "123456 matches"\n\s+direction: DOWN\n\s+centerElement: true/);
  assert.match(profileFlow, /element:\n\s+text: "9876 wins"\n\s+direction: DOWN\n\s+centerElement: true/);
  assert.match(profileFlow, /profile-change-password/);
  assert.match(profileFlow, /profile-password-submit/);
  assert.match(profileFlow, /profile-password-cancel/);
  assert.match(profileFixture, /nativeTextScaleLayoutsFit/);
  assert.match(profileFixture, /profile:action:password/);
});

test('the Android emulator suite runs all three checks at 2× and restores device settings', async () => {
  const [runner, packageSource, workflow] = await Promise.all([
    read('scripts/run-android-player-large-text.mjs'),
    read('package.json'),
    readFile(fromDaily007('../../.github/scripts/android-emulator-verification.sh'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(runner, /const scale = 2/);
  assert.match(runner, /const targetWidthDp = 320/);
  assert.match(runner, /maestro\/home-mode-native-text-scale\/large-text-2x\.yaml/);
  assert.match(runner, /maestro\/wallet-native-text-scale\/large-text\.yaml/);
  assert.match(runner, /maestro\/profile-native-text-scale\/large-text\.yaml/);
  assert.match(runner, /finally\s*\{[\s\S]*?originalScreenSizeOverride[\s\S]*?originalFontScale/);
  assert.match(runner, /Could not apply|Restored Android font scale/);
  assert.match(packageJson.scripts['test:android-player-large-text'], /run-android-player-large-text\.mjs/);
  assert.match(packageJson.scripts['test:player-native-text-scale'], /player-native-text-scale\.test\.mjs/);
  assert.match(workflow, /run_maestro_suite player-large-text test:android-player-large-text/);
});

test('Android runner runs all flows and restores the font scale and screen size after success or failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'player-native-text-scale-'));
  const fontScalePath = join(directory, 'font-scale');
  const sizePath = join(directory, 'size-override');
  const adbPath = join(directory, 'adb');
  const maestroPath = join(directory, 'maestro');
  const maestroLogPath = join(directory, 'maestro.log');

  try {
    await writeFile(fontScalePath, '1.0');
    await writeFile(sizePath, 'none');
    await writeFile(adbPath, `#!/bin/sh
set -eu
case "$*" in
  "devices -l")
    printf 'List of devices attached\\nemulator-5554 device product:stub model:stub\\n'
    ;;
  "shell pm path host.exp.exponent")
    printf 'package:/data/app/host.exp.exponent/base.apk\\n'
    ;;
  "shell wm size")
    printf 'Physical size: 1080x2400\\n'
    size="$(cat "$SIZE_STATE")"
    if [ "$size" != none ]; then printf 'Override size: %s\\n' "$size"; fi
    ;;
  "shell wm size reset")
    printf 'none' > "$SIZE_STATE"
    ;;
  "shell wm size "*)
    printf '%s' "$4" > "$SIZE_STATE"
    ;;
  "shell wm density")
    printf 'Physical density: 440\\n'
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
printf '%s\\n' "$*" >> "$MAESTRO_LOG"
if [ "\${MAESTRO_FAIL:-false}" = true ]; then
  printf 'simulated Maestro failure\\n' >&2
  exit 7
fi
exit 0
`);
    await chmod(adbPath, 0o755);
    await chmod(maestroPath, 0o755);

    const runRunner = (maestroFail) => spawnSync(
      process.execPath,
      [fromDaily007('scripts/run-android-player-large-text.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_DEV_URL: 'exp://127.0.0.1:8081',
          FONT_SCALE_STATE: fontScalePath,
          SIZE_STATE: sizePath,
          MAESTRO_LOG: maestroLogPath,
          MAESTRO_FAIL: String(maestroFail),
          PATH: `${directory}:${process.env.PATH}`,
        },
      },
    );

    const success = runRunner(false);
    assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
    const successfulFlows = await readFile(maestroLogPath, 'utf8');
    assert.match(successfulFlows, /home-mode-native-text-scale\/large-text-2x\.yaml/);
    assert.match(successfulFlows, /wallet-native-text-scale\/large-text\.yaml/);
    assert.match(successfulFlows, /profile-native-text-scale\/large-text\.yaml/);
    assert.equal((successfulFlows.trim().split(/\r?\n/)).length, 3);
    assert.equal(await readFile(fontScalePath, 'utf8'), '1.0');
    assert.equal(await readFile(sizePath, 'utf8'), 'none');

    await writeFile(fontScalePath, '1.0');
    await writeFile(sizePath, 'none');
    await writeFile(maestroLogPath, '');
    const failure = runRunner(true);
    assert.equal(failure.status, 1, `${failure.stdout}\n${failure.stderr}`);
    assert.match(failure.stderr, /Home Maestro flow failed/);
    assert.equal(await readFile(fontScalePath, 'utf8'), '1.0');
    assert.equal(await readFile(sizePath, 'utf8'), 'none');
    assert.match(failure.stdout, /Restored Android screen size/);
    assert.match(failure.stdout, /Restored Android font scale to 1\.0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
