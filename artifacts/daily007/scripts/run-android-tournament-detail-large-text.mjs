import { spawnSync } from 'node:child_process';

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error('Set EXPO_DEV_URL to the Expo development server URL before running this Android test.');
  process.exit(2);
}

const scales = ['1.5', '2'];
const flowPath = 'maestro/tournament-detail-native-text-scale/large-text.yaml';
const localizedFlowPath = 'maestro/tournament-detail-native-text-scale/localized-large-text.yaml';
const localizedScenarios = [
  {
    language: 'hi',
    registration: 'आपका रजिस्ट्रेशन: टीम 01, स्लॉट 1।',
    capacity: '2/48 खिलाड़ी · 1/12 टीमें',
    joinedCount: '1/4 जुड़े',
    joinedBadgeLabel: '4 में से 1 खिलाड़ी जुड़े',
    roomTitle: 'रूम की जानकारी',
    roomIdLabel: 'रूम ID: DETAIL-ROOM-0123456789',
    passwordLabel: 'पासवर्ड: DETAIL-PASSWORD-0123456789',
    copyRoomId: 'रूम ID कॉपी करें',
    copyPassword: 'पासवर्ड कॉपी करें',
    roomCopyFeedback: 'रूम ID क्लिपबोर्ड पर कॉपी की गई।',
    passwordCopyFeedback: 'पासवर्ड क्लिपबोर्ड पर कॉपी किया गया।',
    teamSlots: 'स्क्वाड टीम स्लॉट',
    captainName: 'कप्तान अमन कुमार का बहुत लंबा Free Fire खिलाड़ी नाम',
    teammateName: 'दूसरे खिलाड़ी रोहित कुमार का बहुत लंबा Free Fire नाम',
    openSlot: 'खाली • चुनें',
  },
  {
    language: 'gu',
    registration: 'તમારી નોંધણી: ટીમ 01, સ્લોટ 1.',
    capacity: '2/48 પ્લેયર · 1/12 ટીમ',
    joinedCount: '1/4 જોડાયા',
    joinedBadgeLabel: '4માંથી 1 ખેલાડીઓ જોડાયા',
    roomTitle: 'રૂમની વિગતો',
    roomIdLabel: 'રૂમ ID: DETAIL-ROOM-0123456789',
    passwordLabel: 'પાસવર્ડ: DETAIL-PASSWORD-0123456789',
    copyRoomId: 'રૂમ ID કૉપિ કરો',
    copyPassword: 'પાસવર્ડ કૉપિ કરો',
    roomCopyFeedback: 'રૂમ ID ક્લિપબોર્ડમાં કૉપિ થઈ.',
    passwordCopyFeedback: 'પાસવર્ડ ક્લિપબોર્ડમાં કૉપિ થયો.',
    teamSlots: 'સ્ક્વોડ ટીમ સ્લોટ',
    captainName: 'કેપ્ટન રાજવીર પટેલનું ખૂબ લાંબું Free Fire નામ',
    teammateName: 'બીજા ખેલાડી ધ્રુવ પટેલનું ખૂબ લાંબું Free Fire નામ',
    openSlot: 'ખાલી • પસંદ કરો',
  },
];

function runMaestroFlow(flowPath, scale, language, expected = {}) {
  runChecked(
    'adb',
    ['shell', 'am', 'force-stop', 'host.exp.exponent'],
    'Restarting Expo Go before the tournament detail check',
  );
  const maestroArgs = ['test'];
  if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
    maestroArgs.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}/${scale}-${language}`);
  }
  maestroArgs.push(flowPath);
  const result = run('maestro', maestroArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_DEV_URL: expoDevUrl,
      TOURNAMENT_DETAIL_TEXT_SCALE: Number(scale).toFixed(2),
      TOURNAMENT_DETAIL_TEXT_LANGUAGE: language,
      TOURNAMENT_DETAIL_EXPECTED_REGISTRATION: expected.registration ?? '',
      TOURNAMENT_DETAIL_EXPECTED_CAPACITY: expected.capacity ?? '',
      TOURNAMENT_DETAIL_EXPECTED_JOINED_COUNT: expected.joinedCount ?? '',
      TOURNAMENT_DETAIL_EXPECTED_JOINED_BADGE_LABEL: expected.joinedBadgeLabel ?? '',
      TOURNAMENT_DETAIL_EXPECTED_ROOM_TITLE: expected.roomTitle ?? '',
      TOURNAMENT_DETAIL_EXPECTED_ROOM_ID_LABEL: expected.roomIdLabel ?? '',
      TOURNAMENT_DETAIL_EXPECTED_PASSWORD_LABEL: expected.passwordLabel ?? '',
      TOURNAMENT_DETAIL_EXPECTED_COPY_ROOM_ID: expected.copyRoomId ?? '',
      TOURNAMENT_DETAIL_EXPECTED_COPY_PASSWORD: expected.copyPassword ?? '',
      TOURNAMENT_DETAIL_EXPECTED_ROOM_COPY_FEEDBACK: expected.roomCopyFeedback ?? '',
      TOURNAMENT_DETAIL_EXPECTED_PASSWORD_COPY_FEEDBACK: expected.passwordCopyFeedback ?? '',
      TOURNAMENT_DETAIL_EXPECTED_TEAM_SLOTS: expected.teamSlots ?? '',
      TOURNAMENT_DETAIL_EXPECTED_CAPTAIN_NAME: expected.captainName ?? '',
      TOURNAMENT_DETAIL_EXPECTED_TEAMMATE_NAME: expected.teammateName ?? '',
      TOURNAMENT_DETAIL_EXPECTED_OPEN_SLOT: expected.openSlot ?? '',
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `Maestro failed for tournament details in ${language} at ${Number(scale).toFixed(2)}× (exit code ${result.status ?? 'unknown'}).`,
    );
  }
}

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

function parseDisplaySize(output) {
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const latest = matches.at(-1);
  return latest ? { width: Number(latest[1]), height: Number(latest[2]) } : null;
}

function parseDisplayDensity(output) {
  const matches = [...output.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  const latest = matches.at(-1);
  return latest ? Number(latest[1]) : null;
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

  const displaySize = parseDisplaySize(runChecked(
    'adb',
    ['shell', 'wm', 'size'],
    'Reading Android display size',
  ));
  const displayDensity = parseDisplayDensity(runChecked(
    'adb',
    ['shell', 'wm', 'density'],
    'Reading Android display density',
  ));
  if (!displaySize || !displayDensity) {
    throw new Error('Could not determine the Android screen width in dp for the narrow-phone check.');
  }
  const screenWidthDp = displaySize.width * 160 / displayDensity;
  if (screenWidthDp > 400) {
    throw new Error(
      `This check requires a narrow Android phone with an app width of 400 dp or less; this device is about ${Math.round(screenWidthDp)} dp wide.`,
    );
  }
  console.log(`Checking narrow Android display width: approximately ${Math.round(screenWidthDp)} dp.`);

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

    console.log(`Checking tournament details at ${Number(scale).toFixed(2)}× Android text scale.`);
    runMaestroFlow(flowPath, scale, 'en');
    for (const scenario of localizedScenarios) {
      runMaestroFlow(localizedFlowPath, scale, scenario.language, scenario);
    }
  }
} catch (error) {
  console.error(`Android tournament detail text-scale test failed: ${error.message}`);
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
