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
let originalScreenSizeOverride;
let screenSizeChangeAttempted = false;

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

  const originalScreenSize = runChecked(
    'adb',
    ['shell', 'wm', 'size'],
    'Reading the current Android screen size',
  );
  const physicalSize = originalScreenSize.match(/Physical size:\s*(\d+)x(\d+)/);
  const overrideSize = originalScreenSize.match(/Override size:\s*(\d+)x(\d+)/);
  const currentSize = overrideSize ?? physicalSize;
  if (!currentSize) {
    throw new Error(`Android returned an invalid screen size: ${originalScreenSize || '(empty)'}`);
  }
  originalScreenSizeOverride = overrideSize ? `${overrideSize[1]}x${overrideSize[2]}` : null;

  const originalDensity = runChecked(
    'adb',
    ['shell', 'wm', 'density'],
    'Reading the current Android display density',
  );
  const density = originalDensity.match(/Override density:\s*(\d+)/) ??
    originalDensity.match(/Physical density:\s*(\d+)/);
  if (!density || Number(density[1]) <= 0) {
    throw new Error(`Android returned an invalid display density: ${originalDensity || '(empty)'}`);
  }

  const targetWidthPx = Math.round(320 * Number(density[1]) / 160);
  const targetHeightPx = Math.round(
    Number(currentSize[2]) * targetWidthPx / Number(currentSize[1]),
  );
  const narrowSize = `${targetWidthPx}x${targetHeightPx}`;
  screenSizeChangeAttempted = true;
  runChecked(
    'adb',
    ['shell', 'wm', 'size', narrowSize],
    'Setting Android screen width to 320dp',
  );
  const appliedSize = runChecked(
    'adb',
    ['shell', 'wm', 'size'],
    'Verifying the narrow Android screen size',
  );
  if (!appliedSize.includes(`Override size: ${narrowSize}`)) {
    throw new Error(`Android did not apply the narrow screen size ${narrowSize}.`);
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
  const maestroTestOutputDir = process.env.MAESTRO_TEST_OUTPUT_DIR ||
    `${process.env.HOME || '.'}/.maestro/tests`;
  const maestro = run('maestro', [
    'test',
    `--test-output-dir=${maestroTestOutputDir}`,
    'maestro/wallet-cancellation-refund/large-text.yaml',
  ], {
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
  if (originalScreenSizeOverride !== undefined && screenSizeChangeAttempted) {
    const restore = originalScreenSizeOverride
      ? run('adb', ['shell', 'wm', 'size', originalScreenSizeOverride])
      : run('adb', ['shell', 'wm', 'size', 'reset']);
    if (restore.error || restore.status !== 0) {
      const detail = restore.error?.message || restore.stderr?.trim() || 'unknown ADB error';
      console.error(
        `Could not restore the original Android screen size${originalScreenSizeOverride ? ` ${originalScreenSizeOverride}` : ''} (${detail}).`,
      );
      process.exitCode = 1;
    } else {
      console.log('Restored Android screen size.');
    }
  }

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
