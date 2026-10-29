import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  app,
  profile,
  googleButton,
  nativeFixture,
  fixtureServer,
  runner,
  emulatorScript,
  workflow,
  startFlow,
  offlineFlow,
  retryFlow,
  cleanupFlow,
] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/Profile.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/GoogleSSOButton.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/GoogleLinkNativeTest.tsx", import.meta.url), "utf8"),
  readFile(new URL("./google-link-native-oauth-fixture-server.mjs", import.meta.url), "utf8"),
  readFile(new URL("./run-android-google-link-retry.mjs", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/scripts/android-emulator-verification.sh", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/workflows/android-release-verification.yml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/google-link-native/1-start-native-oauth.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/google-link-native/2-offline-failure.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/google-link-native/3-retry-success.yaml", import.meta.url), "utf8"),
  readFile(new URL("../maestro/google-link-native/restore-session.yaml", import.meta.url), "utf8"),
]);

test("native Google-link test harness is development-only and exercises the production Profile and SSO flow", () => {
  assert.match(app, /export function DailyAppGoogleLinkNativeTest/);
  assert.match(app, /if \(!__DEV__\) return null/);
  assert.match(profile, /label="Connect Google"[\s\S]*?devNativeTestHarness=\{googleSSONativeTestHarness\}/);
  assert.match(profile, /testID="profile-google-connection-title"/);
  assert.match(googleButton, /if \(__DEV__ && props\.devNativeTestHarness\)/);
  assert.match(googleButton, /AuthSession\.makeRedirectUri\(\{ scheme: 'daily007', path: 'sso-callback' \}\)/);
  assert.match(googleButton, /runGoogleSSOAttempt/);
  assert.match(googleButton, /runGoogleSSOFlow/);
  assert.match(googleButton, /startNativeSSOFlow/);
  assert.match(nativeFixture, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeFixture, /Linking\.addEventListener\('url'/);
  assert.match(nativeFixture, /WebBrowser\.openBrowserAsync\(authPageUrl\)/);
  assert.match(nativeFixture, /setActive: async \(\{ session \}\)/);
  assert.match(nativeFixture, /Api\.googleAuth|http\.defaults\.adapter/);
});

test("offline OAuth return preserves the original account, wallet, and password bearer until a successful retry", () => {
  assert.match(nativeFixture, /AuthSession\.makeRedirectUri\(\{ path: 'google-link-native-test' \}\)/);
  assert.match(nativeFixture, /callback\.promise/);
  assert.match(nativeFixture, /id: 'native-google-link-player'/);
  assert.match(nativeFixture, /coins: 42/);
  assert.match(nativeFixture, /token: 'native-google-link-password-token'/);
  assert.match(nativeFixture, /X-Daily007-Token/);
  assert.match(nativeFixture, /failed while Android was offline/);
  assert.match(nativeFixture, /googleLinked\.current = true/);
  assert.match(nativeFixture, /sessionToken: session\?\.token === FIXTURE_SESSION\.token \? 'password token preserved' : 'changed'/);
  assert.match(startFlow, /Continue with test Google/);
  assert.match(startFlow, /id: profile-google-connection-title[\s\S]*?centerElement: false/);
  assert.match(startFlow, /visible: "CONNECT GOOGLE"[\s\S]*?timeout: 30000/);
  assert.match(startFlow, /assertVisible:[\s\S]*?id: continue-with-google/);
  assert.match(
    startFlow,
    /- tapOn:\n    id: continue-with-google\n- tapOn:\n    id: continue-with-google\n    optional: true/,
  );
  assert.match(
    startFlow,
    /id: profile-text-scale-name[\s\S]*?direction: UP[\s\S]*?id: profile-google-connection-title[\s\S]*?direction: DOWN[\s\S]*?speed: 20[\s\S]*?visibilityPercentage: 50[\s\S]*?waitToSettleTimeoutMs: 500[\s\S]*?centerElement: false/,
  );
  assert.match(startFlow, /Use without an account[\s\S]*?optional: true[\s\S]*?waitUntilVisible: true/);
  assert.match(startFlow, /assertNotVisible:[\s\S]*?profile-google-connected/);
  assert.match(offlineFlow, /Could not reach Daily007\. Check your connection and try again\./);
  assert.match(offlineFlow, /First exchange: failed while Android was offline/);
  assert.match(offlineFlow, /id: profile-google-connection-title[\s\S]*?direction: UP[\s\S]*?visible: "CONNECT GOOGLE"[\s\S]*?id: continue-with-google/);
  assert.match(offlineFlow, /Daily007 account: native-google-link-player/);
  assert.match(offlineFlow, /Saved wallet: 42 coins/);
  assert.match(offlineFlow, /Password bearer: password token preserved/);
  assert.match(retryFlow, /Second exchange: succeeded online/);
  assert.match(retryFlow, /profile-google-connected/);
  assert.match(
    retryFlow,
    /- tapOn:\n    id: continue-with-google\n- tapOn:\n    id: continue-with-google\n    optional: true/,
  );
  assert.match(retryFlow, /scrollUntilVisible:[\s\S]*?text: GOOGLE CONNECTED[\s\S]*?direction: UP/);
  assert.match(retryFlow, /continue-with-google[\s\S]*?Second exchange: succeeded online[\s\S]*?Google exchanges: 2/);
  assert.match(retryFlow, /Google session lookups: 4/);
  assert.match(retryFlow, /Clerk token reads: 2/);
  assert.doesNotMatch(retryFlow, /Continue with test Google/);
  assert.match(retryFlow, /Link requests kept password token: 2\/2/);
  assert.match(offlineFlow, /Available coins: 42/);
  assert.match(retryFlow, /Available coins: 42/);
});

test("Android release verification runs the native retry scenario and restores device/session state", () => {
  assert.match(emulatorScript, /EXPO_PUBLIC_GOOGLE_LINK_TEST_AUTH_URL/);
  assert.match(emulatorScript, /google-link-native-oauth-fixture-server\.mjs/);
  assert.match(emulatorScript, /oauth-fixture-adb-reverse/);
  assert.match(emulatorScript, /run_maestro_suite google-link-native-retry test:android-google-link-retry/);
  assert.match(workflow, /test:google-link-native/);
  assert.match(runner, /setConnectivity\(false\)[\s\S]*?2-offline-failure\.yaml[\s\S]*?setConnectivity\(true\)[\s\S]*?3-retry-success\.yaml/);
  assert.match(runner, /"cmd", "connectivity", "airplane-mode", enabled \? "enable" : "disable"/);
  assert.doesNotMatch(runner, /android\.intent\.action\.AIRPLANE_MODE/);
  assert.match(runner, /restore-session\.yaml/);
  assert.match(runner, /setAirplaneModeEnabled\(originalAirplane === "1"\)/);
  assert.match(runner, /setWifiEnabled\(originalWifi === "1"\)/);
  assert.match(cleanupFlow, /scenario=cleanup/);
});

test("local OAuth page only returns a test token through an app deep link", () => {
  assert.match(fixtureServer, /native-google-link-callback-test-token/);
  assert.match(fixtureServer, /Continue with test Google/);
  assert.match(fixtureServer, /<a href=\$\{safeCallback\}>/);
  assert.doesNotMatch(fixtureServer, /window\.location\.assign/);
  assert.match(fixtureServer, /\^\(\?:exp\|daily007\):\\\/\\\//);
  assert.doesNotMatch(fixtureServer, /accounts\.google\.com|oauth\.google/);
});
