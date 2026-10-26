import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running this Android test.');
  process.exit(2);
}

const scales = ['1.5', '2'];
const flows = [
  {
    language: 'en',
    path: 'maestro/tournament-native-text-scale/large-text.yaml',
  },
  {
    language: 'hi',
    path: 'maestro/tournament-native-text-scale/localized-large-text.yaml',
    expected: {
      ALL_FILTER: 'सभी 5',
      KILL_EARN_FILTER: 'बीआर किल और कमाएँ 1',
      KILL_EARN_TITLE: 'अंतरराष्ट्रीय बैटल रॉयल किल एंड अर्न चैंपियनशिप लंबे फाइनल मुकाबलों के साथ',
      BR_TITLE: 'कई क्षेत्रों में अंतरराष्ट्रीय बैटल रॉयल क्लासिक चैंपियनशिप का आयोजन',
      CLASH_TITLE: 'चार दौर के फाइनल के साथ अंतरराष्ट्रीय क्लैश स्क्वाड चैंपियनशिप',
      LONE_WOLF_TITLE: 'विस्तारित क्वालीफायर के साथ अंतरराष्ट्रीय लोन वुल्फ चैंपियनशिप',
      PRIZE_POOL: 'इनाम राशि',
      PER_KILL: 'प्रति किल',
      ENTRY: 'प्रवेश',
      JOINED: '16/48 जुड़े',
      SPOTS_LEFT: '32 जगह बाकी',
      JOIN: 'टूर्नामेंट में शामिल हों',
    },
  },
  {
    language: 'gu',
    path: 'maestro/tournament-native-text-scale/localized-large-text.yaml',
    expected: {
      ALL_FILTER: 'બધા 5',
      KILL_EARN_FILTER: 'બીઆર કિલ અને કમાણી 1',
      KILL_EARN_TITLE: 'આંતરરાષ્ટ્રીય બેટલ રોયલ કિલ અને અર્ન ચેમ્પિયનશિપ લાંબી ફાઇનલ સાથે',
      BR_TITLE: 'ઘણા પ્રદેશોમાં આંતરરાષ્ટ્રીય બેટલ રોયલ ક્લાસિક ચેમ્પિયનશિપ',
      CLASH_TITLE: 'ચાર રાઉન્ડની ફાઇનલ સાથે આંતરરાષ્ટ્રીય ક્લેશ સ્ક્વોડ ચેમ્પિયનશિપ',
      LONE_WOLF_TITLE: 'વિસ્તૃત ક્વોલિફાયર સાથે આંતરરાષ્ટ્રીય લોન વુલ્ફ ચેમ્પિયનશિપ',
      PRIZE_POOL: 'ઇનામ રકમ',
      PER_KILL: 'પ્રતિ કિલ',
      ENTRY: 'પ્રવેશ',
      JOINED: '16/48 જોડાયા',
      SPOTS_LEFT: '32 સ્થાનો બાકી',
      JOIN: 'ટુર્નામેન્ટમાં જોડાઓ',
    },
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function runChecked(command, args, description) {
  const result = run(command, args);
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

  for (const scale of scales) {
    fontScaleChangeAttempted = true;
    runChecked(
      'adb',
      ['shell', 'settings', 'put', 'system', 'font_scale', scale],
      `Setting Android font scale to ${scale}`,
    );
    const actualScale = Number(runChecked(
      'adb',
      ['shell', 'settings', 'get', 'system', 'font_scale'],
      'Verifying the Android font scale',
    ));
    if (!Number.isFinite(actualScale) || Math.abs(actualScale - Number(scale)) > 0.005) {
      throw new Error(`Android did not apply font scale ${scale}; it reports ${actualScale}.`);
    }

    runChecked(
      'adb',
      ['shell', 'am', 'force-stop', 'host.exp.exponent'],
      'Restarting Expo Go for the updated font scale',
    );
    console.log(`Checking tournament cards and filters at ${Number(scale).toFixed(2)}× Android text scale.`);

    for (const flow of flows) {
      const maestroArgs = ['test'];
      if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
        maestroArgs.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
      }
      maestroArgs.push(flow.path);
      const result = run('maestro', maestroArgs, {
        stdio: 'inherit',
        env: {
          ...process.env,
          EXPO_DEV_URL: expoDevUrl,
          TOURNAMENT_TEXT_SCALE: Number(scale).toFixed(2),
          TOURNAMENT_TEXT_LANGUAGE: flow.language,
          ...Object.fromEntries(
            Object.entries(flow.expected ?? {}).map(([key, value]) => [
              `TOURNAMENT_TEXT_EXPECTED_${key}`,
              value,
            ]),
          ),
        },
      });
      if (result.status !== 0) {
        throw new Error(
          `Maestro failed for ${flow.language} tournament cards at ${Number(scale).toFixed(2)}× (exit code ${result.status ?? 'unknown'}).`,
        );
      }
    }
  }
} catch (error) {
  console.error(`Android tournament-card text-scale test failed: ${error.message}`);
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
    } else {
      const restored = run(
        'adb',
        ['shell', 'settings', 'get', 'system', 'font_scale'],
      );
      const restoredValue = restored.stdout?.trim() ?? '';
      const restoredScale = Number(restoredValue);
      if (
        restored.error
        || restored.status !== 0
        || !/^\d+(?:\.\d+)?$/.test(restoredValue)
        || !Number.isFinite(restoredScale)
        || Math.abs(restoredScale - Number(originalFontScale)) > 0.005
      ) {
        const detail = restored.error?.message
          || restored.stderr?.trim()
          || `received ${restoredValue || '(empty)'}`;
        console.error(`Could not verify restoration of Android font scale to ${originalFontScale} (${detail}).`);
        process.exitCode = 1;
      }
    }
  }
}
