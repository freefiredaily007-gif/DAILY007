import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running these Android checks.');
  process.exit(2);
}

const suites = [
  {
    name: 'Home',
    flow: 'maestro/home-mode-native-text-scale/large-text-2x.yaml',
  },
  {
    name: 'Wallet',
    flow: 'maestro/wallet-native-text-scale/large-text.yaml',
  },
  {
    name: 'Profile',
    flow: 'maestro/profile-native-text-scale/large-text.yaml',
  },
];
const scale = 2;
const targetWidthDp = 320;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function runChecked(command, args, description) {
  const result = run(command, args);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`${description} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

function outputFailure(result, description) {
  const detail = result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    `exit code ${result.status ?? 'unknown'}`;
  console.error(`${description} failed: ${detail}`);
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
      `Expected exactly one authorized Android device or emulator; found ${onlineDevices.length}. Check "adb devices -l" and disconnect additional devices.`,
    );
  }

  const expoGo = runChecked('adb', ['shell', 'pm', 'path', 'host.exp.exponent'], 'Checking Expo Go installation');
  if (!expoGo.startsWith('package:')) {
    throw new Error('Expo Go is not installed on the connected Android device or emulator.');
  }

  const originalScreenSize = runChecked('adb', ['shell', 'wm', 'size'], 'Reading the current Android screen size');
  const physicalSize = originalScreenSize.match(/Physical size:\s*(\d+)x(\d+)/);
  const overrideSize = originalScreenSize.match(/Override size:\s*(\d+)x(\d+)/);
  const currentSize = overrideSize ?? physicalSize;
  if (!currentSize) {
    throw new Error(`Android returned an invalid screen size: ${originalScreenSize || '(empty)'}`);
  }
  originalScreenSizeOverride = overrideSize ? `${overrideSize[1]}x${overrideSize[2]}` : null;

  const originalDensity = runChecked('adb', ['shell', 'wm', 'density'], 'Reading the current Android display density');
  const density = originalDensity.match(/Override density:\s*(\d+)/) ??
    originalDensity.match(/Physical density:\s*(\d+)/);
  if (!density || Number(density[1]) <= 0) {
    throw new Error(`Android returned an invalid display density: ${originalDensity || '(empty)'}`);
  }

  const targetWidthPx = Math.round(targetWidthDp * Number(density[1]) / 160);
  const targetHeightPx = Math.round(Number(currentSize[2]) * targetWidthPx / Number(currentSize[1]));
  const narrowSize = `${targetWidthPx}x${targetHeightPx}`;
  screenSizeChangeAttempted = true;
  runChecked('adb', ['shell', 'wm', 'size', narrowSize], `Setting Android screen width to ${targetWidthDp}dp`);
  const appliedSize = runChecked('adb', ['shell', 'wm', 'size'], 'Verifying the narrow Android screen size');
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
    ['shell', 'settings', 'put', 'system', 'font_scale', String(scale)],
    `Setting Android font scale to ${scale}`,
  );
  const actualScale = Number(runChecked(
    'adb',
    ['shell', 'settings', 'get', 'system', 'font_scale'],
    'Verifying the Android font scale',
  ));
  if (!Number.isFinite(actualScale) || Math.abs(actualScale - scale) > 0.005) {
    throw new Error(`Android did not apply font scale ${scale}; it reports ${actualScale}.`);
  }

  runChecked(
    'adb',
    ['shell', 'am', 'force-stop', 'host.exp.exponent'],
    'Restarting Expo Go for the updated font scale and display width',
  );
  for (const suite of suites) {
    console.log(`Running Android ${suite.name} checks at 2× text scale and ${targetWidthDp}dp width.`);
    const maestroArgs = ['test'];
    if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
      maestroArgs.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
    }
    maestroArgs.push(suite.flow);
    const maestro = run('maestro', maestroArgs, {
      stdio: 'inherit',
      env: { ...process.env, EXPO_DEV_URL: expoDevUrl },
    });
    if (maestro.error || maestro.status !== 0) {
      throw new Error(`${suite.name} Maestro flow failed (exit code ${maestro.status ?? 'unknown'}).`);
    }
  }
} catch (error) {
  console.error(`Android Home, Wallet, and Profile 2× text checks failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (originalScreenSizeOverride !== undefined && screenSizeChangeAttempted) {
    const restore = originalScreenSizeOverride
      ? run('adb', ['shell', 'wm', 'size', originalScreenSizeOverride])
      : run('adb', ['shell', 'wm', 'size', 'reset']);
    if (restore.error || restore.status !== 0) {
      outputFailure(restore, 'Restoring the original Android screen size');
      process.exitCode = 1;
    } else {
      const restoredSize = run('adb', ['shell', 'wm', 'size']);
      const expectedSizeRestored = originalScreenSizeOverride
        ? restoredSize.stdout?.includes(`Override size: ${originalScreenSizeOverride}`)
        : !/Override size:\s*\d+x\d+/.test(restoredSize.stdout ?? '');
      if (restoredSize.error || restoredSize.status !== 0 || !expectedSizeRestored) {
        outputFailure(restoredSize, 'Verifying restoration of the original Android screen size');
        process.exitCode = 1;
      } else {
        console.log('Restored Android screen size.');
      }
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
      outputFailure(restore, `Restoring Android font scale to ${originalFontScale}`);
      process.exitCode = 1;
    } else {
      const restoredScaleResult = run('adb', ['shell', 'settings', 'get', 'system', 'font_scale']);
      const restoredScale = Number(restoredScaleResult.stdout?.trim());
      if (
        restoredScaleResult.error
        || restoredScaleResult.status !== 0
        || !Number.isFinite(restoredScale)
        || Math.abs(restoredScale - Number(originalFontScale)) > 0.005
      ) {
        outputFailure(restoredScaleResult, `Verifying restoration of Android font scale to ${originalFontScale}`);
        process.exitCode = 1;
      } else {
        console.log(`Restored Android font scale to ${originalFontScale}.`);
      }
    }

    const restart = run('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent']);
    if (restart.error || restart.status !== 0) {
      outputFailure(restart, 'Restarting Expo Go after restoring Android display settings');
      process.exitCode = 1;
    }
  }
}
