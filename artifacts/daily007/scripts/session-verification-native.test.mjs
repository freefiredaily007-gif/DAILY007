import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/session-verification.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/SessionVerificationNativeTest.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/session-verification-test.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/SessionVerificationPaused.tsx", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/network-reconnect.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/network-restored.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/network-restart-restored.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/reboot-restored.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/seed-saved-session.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/restore-saved-session.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/background-before-reconnect.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/resume-after-reconnect.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/transient-retry.yaml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/run-android-session-verification.mjs", import.meta.url), "utf8"),
  readFile(new URL("../maestro/session-verification/README.md", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/workflows/android-release-verification.yml", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/scripts/android-emulator-verification.sh", import.meta.url), "utf8"),
]);

const [
  app,
  recovery,
  fixture,
  route,
  pausedScreen,
  networkReconnect,
  networkRestored,
  networkRestartRestored,
  rebootRestored,
  seedSavedSession,
  restoreSavedSession,
  backgroundBeforeReconnect,
  resumeAfterReconnect,
  transientRetry,
  runner,
  readme,
  androidWorkflow,
  api,
  emulatorScript,
] = files;

test("production and native fixture share session-recovery listeners and paused-session UI", () => {
  assert.match(app, /subscribeToSessionVerificationRecovery\(/);
  assert.match(app, /<SessionVerificationPaused/);
  assert.match(recovery, /network\.addNetworkStateListener\(retryIfOnline\)/);
  assert.match(recovery, /state !== 'active'/);
  assert.match(recovery, /network\.getNetworkStateAsync\(\)\.then\(retryIfOnline\)/);
  assert.match(fixture, /subscribeToSessionVerificationRecovery\(/);
  assert.match(fixture, /<SessionVerificationPaused/);
  assert.match(fixture, /restoreDaily007Session\(/);
  assert.match(route, /SessionVerificationNativeTest/);
  assert.match(fixture, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(pausedScreen, /testID="session-verification-paused-title"/);
  assert.match(pausedScreen, /testID="session-verification-retry"/);
});

test("native flows reconnect without tapping Retry and verify after app resume", () => {
  assert.match(networkReconnect, /session-verification-test\?scenario=network/);
  assert.match(networkReconnect, /assertVisible: "SESSION VERIFICATION PAUSED"/);
  assert.match(networkRestored, /Saved session automatically verified/);
  assert.match(networkRestored, /Verified without tapping Retry/);
  assert.doesNotMatch(`${networkReconnect}\n${networkRestored}`, /tapOn:[\s\S]*?session-verification-retry/);
  assert.match(networkRestartRestored, /session-verification-test\?scenario=network/);
  assert.match(networkRestartRestored, /Saved session automatically verified/);
  assert.match(networkRestartRestored, /Verified without tapping Retry/);
  assert.doesNotMatch(networkRestartRestored, /tapOn:[\s\S]*?session-verification-retry/);
  assert.match(
    runner,
    /runMaestro\("maestro\/session-verification\/network-reconnect\.yaml"\);[\s\S]*?force-stop", "host\.exp\.exponent"[\s\S]*?restoreConnectivity\(\);[\s\S]*?network-restart-restored\.yaml/,
  );

  assert.match(backgroundBeforeReconnect, /session-verification-test\?scenario=resume/);
  assert.match(backgroundBeforeReconnect, /assertVisible: "SESSION VERIFICATION PAUSED"/);
  assert.match(backgroundBeforeReconnect, /pressKey: HOME/);
  assert.match(resumeAfterReconnect, /Saved session automatically verified/);
  assert.match(resumeAfterReconnect, /Verified without tapping Retry/);
  assert.doesNotMatch(`${backgroundBeforeReconnect}\n${resumeAfterReconnect}`, /tapOn:[\s\S]*?session-verification-retry/);
  assert.match(fixture, /scenario === 'resume' && AppState\.currentState !== 'active'/);
});

test("Android restart flow seeds and restores the real persisted Daily007 session", () => {
  assert.match(api, /const KEY = 'daily007_v2_session'/);
  assert.match(fixture, /import \{ getSession, setSession, type User \} from '\.\.\/lib\/api'/);
  assert.match(fixture, /void seedSavedSession\(\)/);
  assert.match(fixture, /await setSession\(FIXTURE_SESSION\)/);
  assert.match(fixture, /restoreDaily007Session\(\s*getSession/);
  assert.doesNotMatch(fixture, /savedSession\.current/);

  assert.match(seedSavedSession, /session-verification-test\?scenario=seed/);
  assert.match(seedSavedSession, /session-verification-test-seeded/);
  assert.match(restoreSavedSession, /scenario=cleanup/);
  assert.match(restoreSavedSession, /session-verification-test-cleaned/);
  assert.match(fixture, /SESSION_BACKUP_KEY/);
  assert.match(fixture, /await getSession\(\)/);
  assert.match(fixture, /await setSession\(backup\.session \?\? null\)/);
  const seedIndex = runner.indexOf('runMaestro("maestro/session-verification/seed-saved-session.yaml")');
  const offlineIndex = runner.indexOf("disableConnectivity();", seedIndex);
  const forceStopIndex = runner.indexOf('"am", "force-stop", "host.exp.exponent"', offlineIndex);
  assert.ok(seedIndex >= 0 && offlineIndex > seedIndex && forceStopIndex > offlineIndex);
  assert.match(runner, /finally\s*\{[\s\S]*?restore-saved-session\.yaml[\s\S]*?originalWifiState/);
  assert.match(networkReconnect, /session-verification-test\?scenario=network/);
  assert.match(networkRestored, /Verified without tapping Retry/);
  assert.match(readme, /AsyncStorage-backed session functions/);
});

test("Android full reboot restores the persisted session without a Retry tap", () => {
  assert.match(runner, /function rebootWhileOfflineAndWaitForBoot\(\)/);
  assert.match(runner, /"adb", \["reboot"\]/);
  assert.match(runner, /"adb",\s*\["wait-for-device"\]/);
  assert.match(runner, /getprop", "sys\.boot_completed/);
  assert.match(runner, /readAirplaneModeState\(\) === "1" && readWifiState\(\) === "0"/);
  assert.match(
    runner,
    /seed-saved-session\.yaml"\);[\s\S]*?disableConnectivity\(\);[\s\S]*?rebootWhileOfflineAndWaitForBoot\(\);[\s\S]*?restoreConnectivity\(\);[\s\S]*?reboot-restored\.yaml/,
  );
  assert.match(rebootRestored, /session-verification-test\?scenario=network/);
  assert.match(rebootRestored, /Saved session automatically verified/);
  assert.match(rebootRestored, /Verified without tapping Retry/);
  assert.doesNotMatch(rebootRestored, /tapOn:[\s\S]*?session-verification-retry/);
  assert.match(readme, /reboots Android/);
  assert.match(readme, /remain disabled/);
});

test("transient verification failure keeps the saved session and Retry available", () => {
  assert.match(fixture, /scenario === 'transient' && attempt <= 2/);
  assert.match(fixture, /status: 503/);
  assert.match(fixture, /token: 'native-session-recovery-token'/);
  assert.match(transientRetry, /Verification attempts: 2/);
  assert.match(transientRetry, /session-verification-test-saved-token/);
  assert.match(transientRetry, /native-session-recovery-token/);
  assert.match(transientRetry, /id: session-verification-retry/);
  assert.match(transientRetry, /id: session-verification-test-retry-ready/);
  assert.match(transientRetry, /Verified after tapping Retry/);
});

test("Android runner toggles and restores Wi-Fi and is included in the release gate", () => {
  assert.match(runner, /svc", "wifi", enabled \? "enable" : "disable"/);
  assert.match(runner, /android\.intent\.action\.AIRPLANE_MODE/);
  assert.match(runner, /originalWifiState/);
  assert.match(runner, /originalAirplaneModeState/);
  assert.match(runner, /finally\s*\{[\s\S]*?setAirplaneModeEnabled\(originalAirplaneModeState === "1"\)[\s\S]*?setWifiEnabled\(originalWifiState === "1"\)/);
  assert.match(runner, /background-before-reconnect\.yaml/);
  assert.match(runner, /resume-after-reconnect\.yaml/);
  assert.match(runner, /transient-retry\.yaml/);
  assert.match(androidWorkflow, /test:session-verification-native/);
  assert.match(emulatorScript, /test:android-session-verification/);
  assert.match(readme, /Android emulator/);
  assert.match(readme, /Device checklist/);
  assert.match(readme, /Retry is never tapped/);
});
