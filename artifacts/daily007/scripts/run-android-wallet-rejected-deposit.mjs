import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running this Android test.');
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

let previousFontScale;
try {
  const readScale = run('adb', ['shell', 'settings', 'get', 'system', 'font_scale']);
  if (readScale.status !== 0) {
    throw new Error(readScale.stderr || 'Could not read the Android font scale.');
  }
  previousFontScale = readScale.stdout.trim();
  if (!/^\d+(?:\.\d+)?$/.test(previousFontScale)) {
    throw new Error(`Android returned an invalid font scale: ${previousFontScale || '(empty)'}`);
  }

  const setScale = run('adb', ['shell', 'settings', 'put', 'system', 'font_scale', '1.5']);
  if (setScale.status !== 0) {
    throw new Error(setScale.stderr || 'Could not set the Android font scale to 1.5.');
  }
  const stopExpoGo = run('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent']);
  if (stopExpoGo.status !== 0) {
    throw new Error(stopExpoGo.stderr || 'Could not restart Expo Go at the new font scale.');
  }

  const maestro = run('maestro', ['test', 'maestro/wallet-rejected-deposit'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (maestro.error) throw maestro.error;
  process.exitCode = maestro.status ?? 1;
} catch (error) {
  console.error(`Android rejected-deposit test failed to start: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (previousFontScale) {
    const restore = run('adb', [
      'shell',
      'settings',
      'put',
      'system',
      'font_scale',
      previousFontScale,
    ]);
    if (restore.status !== 0) {
      console.error(
        `Could not restore Android font scale to ${previousFontScale}. Restore it in Android Settings.`,
      );
      process.exitCode = 1;
    }
    run('adb', ['shell', 'am', 'force-stop', 'host.exp.exponent']);
  }
}
