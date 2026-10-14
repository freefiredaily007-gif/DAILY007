import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running this Android test.');
  process.exit(2);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function runChecked(command, args, description) {
  const result = run(command, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status ?? 'unknown'}`;
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
      `Expected exactly one authorized Android device or emulator; found ${onlineDevices.length}. Check "adb devices -l" and disconnect additional devices.`,
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

  runChecked('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent'], 'Restarting Expo Go for the updated font scale');
  const maestroArgs = ['test'];
  if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
    maestroArgs.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
  }
  maestroArgs.push('maestro/my-matches-native-text-scale/large-text.yaml');
  const maestro = run('maestro', maestroArgs, {
    stdio: 'inherit',
    env: { ...process.env, MY_MATCHES_TEXT_SCALE: '1.50' },
  });
  if (maestro.error) throw maestro.error;
  if (maestro.status !== 0) {
    throw new Error(`Maestro failed for My Matches at 1.50× text scale (exit code ${maestro.status ?? 'unknown'}).`);
  }
} catch (error) {
  console.error(`Android My Matches large-text test failed: ${error.message}`);
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
      console.error(`Could not restore Android font scale to ${originalFontScale} (${detail}). Restore it in Android Settings.`);
      process.exitCode = 1;
    }

    if (!restore.error && restore.status === 0) {
      const restoredValue = run(
        'adb',
        ['shell', 'settings', 'get', 'system', 'font_scale'],
      );
      if (restoredValue.error || restoredValue.status !== 0) {
        const detail = restoredValue.error?.message || restoredValue.stderr?.trim() || 'unknown ADB error';
        console.error(`Could not verify restoration of Android font scale to ${originalFontScale} (${detail}).`);
        process.exitCode = 1;
      } else {
        const restoredScale = Number(restoredValue.stdout?.trim());
        if (!Number.isFinite(restoredScale) || Math.abs(restoredScale - Number(originalFontScale)) > 0.005) {
          console.error(
            `Android font scale was not restored: expected ${originalFontScale}, received ${restoredValue.stdout?.trim() || '(empty)'}.`,
          );
          process.exitCode = 1;
        } else {
          console.log(`Restored Android font scale to ${originalFontScale}.`);
        }
      }

      const restart = run('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent']);
      if (restart.error || restart.status !== 0) {
        console.error('Could not restart Expo Go after restoring the font scale.');
        process.exitCode = 1;
      }
    }
  }
}
