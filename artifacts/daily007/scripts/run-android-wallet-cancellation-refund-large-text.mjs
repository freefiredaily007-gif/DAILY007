import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running this Android test.');
  process.exit(2);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function runChecked(command, args, description, options = {}) {
  const result = run(command, args, options);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`${description} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

let originalFontScale;
let fontScaleChangeAttempted = false;

try {
  const devicesOutput = runChecked('adb', ['devices', '-l'], 'Listing Android devices');
  const onlineDevices = devicesOutput
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
  if (onlineDevices.length !== 1) {
    throw new Error(
      `Expected exactly one authorized Android device or emulator; found ${onlineDevices.length}.`,
    );
  }

  const expoGo = runChecked('adb', ['shell', 'pm', 'path', 'host.exp.exponent'], 'Checking Expo Go installation');
  if (!expoGo.startsWith('package:')) {
    throw new Error('Expo Go is not installed on the connected Android device or emulator.');
  }

  originalFontScale = runChecked(
    'adb',
    ['shell', 'settings', 'get', 'system', 'font_scale'],
    'Reading the current Android font scale',
  );
  if (!/^\d+(?:\.\d+)?$/.test(originalFontScale)) {
    throw new Error(`Android returned an invalid font scale: ${originalFontScale || '(empty)'}`);
  }

  fontScaleChangeAttempted = true;
  runChecked(
    'adb',
    ['shell', 'settings', 'put', 'system', 'font_scale', '1.5'],
    'Setting Android font scale to 1.5',
  );
  const actualScale = Number(runChecked(
    'adb',
    ['shell', 'settings', 'get', 'system', 'font_scale'],
    'Verifying the Android font scale',
  ));
  if (!Number.isFinite(actualScale) || Math.abs(actualScale - 1.5) > 0.005) {
    throw new Error(`Android did not apply font scale 1.5; it reports ${actualScale}.`);
  }

  runChecked(
    'adb',
    ['shell', 'am', 'force-stop', 'host.exp.exponent'],
    'Restarting Expo Go for the updated font scale',
  );
  const maestro = run('maestro', ['test', 'maestro/wallet-cancellation-refund/large-text.yaml'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (maestro.error || maestro.status !== 0) {
    throw new Error(
      `Maestro failed at 1.5× text (exit code ${maestro.status ?? 'unknown'}).`,
    );
  }
} catch (error) {
  console.error(`Android cancellation-refund large-text test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (originalFontScale && fontScaleChangeAttempted) {
    const restore = run('adb', [
      'shell',
      'settings',
      'put',
      'system',
      'font_scale',
      originalFontScale,
    ]);
    if (restore.error || restore.status !== 0) {
      const detail = restore.error?.message || restore.stderr?.trim() || 'unknown ADB error';
      console.error(
        `Could not restore Android font scale to ${originalFontScale} (${detail}). Restore it in Android Settings.`,
      );
      process.exitCode = 1;
    }

    const restart = run('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent']);
    if (restart.error || restart.status !== 0) {
      console.error('Could not restart Expo Go after restoring the Android font scale.');
      process.exitCode = 1;
    }
    if (restore.status === 0) {
      console.log(`Restored Android font scale to ${originalFontScale}.`);
    }
  }
}
