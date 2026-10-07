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
  const state = runChecked(
    "adb",
    ["shell", "settings", "get", "global", "wifi_on"],
    "Reading the Android Wi-Fi setting",
  );
  if (state !== "0" && state !== "1") {
    throw new Error(`Android returned an invalid Wi-Fi setting: ${state || "(empty)"}`);
  }
  return state;
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (readWifiState() === expectedState) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Android Wi-Fi did not switch ${enabled ? "on" : "off"} within 15 seconds.`);
}

function setAirplaneModeEnabled(enabled) {
  const state = enabled ? "1" : "0";
  runChecked(
    "adb",
    ["shell", "settings", "put", "global", "airplane_mode_on", state],
    `Setting Android airplane mode ${enabled ? "on" : "off"}`,
  );
  runChecked(
    "adb",
    ["shell", "am", "broadcast", "-a", "android.intent.action.AIRPLANE_MODE", "--ez", "state", String(enabled)],
    "Applying the Android airplane-mode change",
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

function runMaestro(flowPath) {
  console.log(`Running Android flow ${flowPath}.`);
  const result = run("maestro", ["test", flowPath], {
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

  originalWifiState = readWifiState();
  originalAirplaneModeState = readAirplaneModeState();
  connectivityChangeAttempted = true;
  restoreConnectivity();

  disableConnectivity();
  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go offline");
  runMaestro("maestro/session-verification/network-reconnect.yaml");
  restoreConnectivity();
  runMaestro("maestro/session-verification/network-restored.yaml");

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

  runChecked("adb", ["shell", "am", "force-stop", "host.exp.exponent"], "Restarting Expo Go for transient failure");
  runMaestro("maestro/session-verification/transient-retry.yaml");
} catch (error) {
  console.error(`Android saved-session recovery test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
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
