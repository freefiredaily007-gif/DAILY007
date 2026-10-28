import { spawnSync } from "node:child_process";

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error("Set EXPO_DEV_URL to the Expo development server URL before running this Android test.");
  process.exit(2);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function runChecked(command, args, description, options = {}) {
  const result = run(command, args, options);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() ||
      `exit code ${result.status ?? "unknown"}`;
    throw new Error(`${description} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function readWifiState() {
  return runChecked(
    "adb",
    ["shell", "settings", "get", "global", "wifi_on"],
    "Reading the Android Wi-Fi setting",
  );
}

function readStableWifiState() {
  let lastState = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    lastState = readWifiState();
    if (lastState === "0" || lastState === "1") return lastState;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(
    `Android Wi-Fi setting did not settle to enabled or disabled within 15 seconds (last setting: ${lastState || "(empty)"}).`,
  );
}

function waitForWifiState(expectedState, description) {
  let lastState = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    lastState = readWifiState();
    if (lastState === expectedState) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`${description} (last Android Wi-Fi setting: ${lastState || "(empty)"}).`);
}

function readAirplaneModeState() {
  const state = runChecked(
    "adb",
    ["shell", "settings", "get", "global", "airplane_mode_on"],
    "Reading the Android airplane-mode setting",
  );
  if (state !== "0" && state !== "1") {
    throw new Error(`Android returned an invalid airplane-mode setting: ${state || "(empty)"}`);
  }
  return state;
}

function setWifiEnabled(enabled) {
  runChecked(
    "adb",
    ["shell", "svc", "wifi", enabled ? "enable" : "disable"],
    `${enabled ? "Enabling" : "Disabling"} Android Wi-Fi`,
  );

  const expectedState = enabled ? "1" : "0";
  waitForWifiState(
    expectedState,
    `Android Wi-Fi did not switch ${enabled ? "on" : "off"} within 15 seconds`,
  );
}

function setAirplaneModeEnabled(enabled) {
  const state = enabled ? "1" : "0";
  runChecked(
    "adb",
    ["shell", "cmd", "connectivity", "airplane-mode", enabled ? "enable" : "disable"],
    `Applying Android airplane mode ${enabled ? "on" : "off"}`,
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (readAirplaneModeState() === state) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Android airplane mode did not switch ${enabled ? "on" : "off"} within 15 seconds.`);
}

function disableConnectivity() {
  setAirplaneModeEnabled(true);
  setWifiEnabled(false);
}

function restoreConnectivity() {
  setAirplaneModeEnabled(false);
  setWifiEnabled(true);
}

function restoreMetroReverse() {
  const metroPort = process.env.METRO_PORT || new URL(expoDevUrl).port;
  if (!/^\d+$/.test(metroPort)) {
    throw new Error(`Could not determine the Metro port from METRO_PORT or EXPO_DEV_URL: ${expoDevUrl}`);
  }
  runChecked(
    "adb",
    ["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`],
    "Restoring the ADB reverse mapping for Metro after Android reboot",
  );
  const reverseMappings = runChecked("adb", ["reverse", "--list"], "Checking the ADB reverse mapping for Metro");
  if (!reverseMappings.includes(`tcp:${metroPort} tcp:${metroPort}`)) {
    throw new Error(`ADB reverse mapping for Metro port ${metroPort} is missing after Android reboot.`);
  }
  console.log(`Restored and verified the ADB reverse mapping for Metro port ${metroPort}.`);
}

function rebootWhileOfflineAndWaitForBoot() {
  runChecked("adb", ["reboot"], "Rebooting Android while connectivity is disabled");
  runChecked(
    "adb",
    ["wait-for-device"],
    "Waiting for Android to reconnect after reboot",
    { timeout: 180_000 },
  );

  let lastBootState = "";
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const bootState = run("adb", ["shell", "getprop", "sys.boot_completed"]);
    if (bootState.status === 0 && bootState.stdout?.trim() === "1") {
      lastBootState = "Android reported boot complete";
      if (readAirplaneModeState() === "1" && readWifiState() === "0") {
        console.log("Android finished rebooting with airplane mode on and Wi-Fi disabled.");
        return;
      }
      lastBootState = "Android booted, but its offline network settings did not persist";
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(
    `Android did not finish rebooting offline within 180 seconds (${lastBootState || "boot is still incomplete"}).`,
  );
}

function runMaestro(flowPath) {
  console.log(`Running Android flow ${flowPath}.`);
  const args = ["test"];
  if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
    args.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
  }
  args.push(flowPath);
  const result = run("maestro", args, {
    stdio: "inherit",
    env: { ...process.env, EXPO_DEV_URL: expoDevUrl },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Maestro flow ${flowPath} failed: ${result.error?.message || `exit code ${result.status ?? "unknown"}`}`,
    );
  }
}

let originalWifiState;
let originalAirplaneModeState;
let connectivityChangeAttempted = false;
let sessionSeedAttempted = false;

try {
  const devices = runChecked("adb", ["devices", "-l"], "Listing Android devices")
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
  if (devices.length !== 1) {
    throw new Error(
      `Expected exactly one authorized Android device or emulator; found ${devices.length}. Check "adb devices -l" and disconnect additional devices.`,
    );
  }

  const expoGo = runChecked(
    "adb",
    ["shell", "pm", "path", "host.exp.exponent"],
    "Checking Expo Go installation",
  );
  if (!expoGo.startsWith("package:")) {
    throw new Error("Expo Go is not installed on the connected Android device or emulator.");
  }

  originalWifiState = readStableWifiState();
  originalAirplaneModeState = readAirplaneModeState();
  connectivityChangeAttempted = true;
  restoreConnectivity();
  sessionSeedAttempted = true;
  runMaestro("maestro/session-verification/seed-saved-session.yaml");

  disableConnectivity();
  rebootWhileOfflineAndWaitForBoot();
  restoreConnectivity();
  restoreMetroReverse();
  runMaestro("maestro/session-verification/reboot-restored.yaml");

  disableConnectivity();
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go offline");
  runMaestro("maestro/session-verification/network-reconnect.yaml");
  restoreConnectivity();
  runMaestro("maestro/session-verification/network-restored.yaml");

  disableConnectivity();
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go offline");
  runMaestro("maestro/session-verification/network-reconnect.yaml");
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Stopping Expo Go while saved-session verification is paused offline");
  restoreConnectivity();
  runMaestro("maestro/session-verification/network-restart-restored.yaml");

  disableConnectivity();
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go offline");
  runMaestro("maestro/session-verification/background-before-reconnect.yaml");
  restoreConnectivity();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  runChecked(
    "adb",
    ["shell", "monkey", "-p", "host.exp.exponent", "1"],
    "Bringing Expo Go back to the foreground",
  );
  runMaestro("maestro/session-verification/resume-after-reconnect.yaml");

  disableConnectivity();
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go offline for repeated recovery");
  runMaestro("maestro/session-verification/repeated-start.yaml");
  restoreConnectivity();
  runMaestro("maestro/session-verification/repeated-first-retry.yaml");
  disableConnectivity();
  runChecked("adb", ["shell", "input", "keyevent", "3"], "Backgrounding Expo Go while recovery is paused");
  restoreConnectivity();
  runChecked(
    "adb",
    ["shell", "monkey", "-p", "host.exp.exponent", "1"],
    "Bringing Expo Go back to the foreground for a repeated recovery attempt",
  );
  runMaestro("maestro/session-verification/repeated-resume-retry.yaml");
  disableConnectivity();
  restoreConnectivity();
  runMaestro("maestro/session-verification/repeated-verified.yaml");

  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go for transient failure");
  runMaestro("maestro/session-verification/transient-retry.yaml");
} catch (error) {
  console.error(`Android saved-session recovery test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (sessionSeedAttempted) {
    try {
      setAirplaneModeEnabled(false);
      setWifiEnabled(true);
      runMaestro("maestro/session-verification/restore-saved-session.yaml");
      console.log("Restored the app's saved session from before the native test.");
    } catch (error) {
      console.error(`Could not restore the app's previous saved session (${error.message}). Reopen the session-verification-test cleanup route while online.`);
      process.exitCode = 1;
    }
  }
  if (originalWifiState !== undefined && originalAirplaneModeState !== undefined && connectivityChangeAttempted) {
    try {
      setAirplaneModeEnabled(originalAirplaneModeState === "1");
      setWifiEnabled(originalWifiState === "1");
      console.log(
        `Restored Android airplane mode to ${originalAirplaneModeState === "1" ? "enabled" : "disabled"} and Wi-Fi to ${originalWifiState === "1" ? "enabled" : "disabled"}.`,
      );
    } catch (error) {
      console.error(`Could not restore the Android network settings (${error.message}). Restore them in Android Settings.`);
      process.exitCode = 1;
    }
  }
}
