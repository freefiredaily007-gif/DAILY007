import { spawnSync } from "node:child_process";

const expoDevUrl = process.env.EXPO_DEV_URL;
const fixturePort = process.env.GOOGLE_LINK_OAUTH_FIXTURE_PORT;
if (!expoDevUrl || !fixturePort) {
  console.error("Set EXPO_DEV_URL and GOOGLE_LINK_OAUTH_FIXTURE_PORT before running this Android test.");
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

function readSetting(name) {
  const value = runChecked(
    "adb",
    ["shell", "settings", "get", "global", name],
    `Reading Android ${name}`,
  );
  if (value !== "0" && value !== "1") {
    throw new Error(`Android returned an invalid ${name} setting: ${value || "(empty)"}`);
  }
  return value;
}

function setWifiEnabled(enabled) {
  runChecked(
    "adb",
    ["shell", "svc", "wifi", enabled ? "enable" : "disable"],
    `${enabled ? "Enabling" : "Disabling"} Android Wi-Fi`,
  );
  const expected = enabled ? "1" : "0";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (readSetting("wifi_on") === expected) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Android Wi-Fi did not switch ${enabled ? "on" : "off"} within 15 seconds.`);
}

function setAirplaneModeEnabled(enabled) {
  const value = enabled ? "1" : "0";
  runChecked(
    "adb",
    ["shell", "cmd", "connectivity", "airplane-mode", enabled ? "enable" : "disable"],
    `Applying Android airplane mode ${enabled ? "on" : "off"}`,
  );
  if (readSetting("airplane_mode_on") !== value) {
    throw new Error(`Android airplane mode did not switch ${enabled ? "on" : "off"}.`);
  }
}

function setConnectivity(online) {
  setAirplaneModeEnabled(!online);
  setWifiEnabled(online);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}

function runMaestro(flow) {
  console.log(`Running native Google-link flow ${flow}.`);
  const args = ["test"];
  if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
    args.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
  }
  args.push(flow);
  const result = run("maestro", args, {
    stdio: "inherit",
    env: { ...process.env, EXPO_DEV_URL: expoDevUrl },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Maestro flow ${flow} failed: ${result.error?.message || `exit code ${result.status ?? "unknown"}`}`);
  }
}

let originalWifi;
let originalAirplane;
let connectivityTouched = false;
let fixtureReversed = false;
let testSessionSeeded = false;
let failed = false;

try {
  const connectedDevices = runChecked("adb", ["devices", "-l"], "Listing Android devices")
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
  if (connectedDevices.length !== 1) {
    throw new Error(`Expected one authorized Android device or emulator; found ${connectedDevices.length}.`);
  }
  const expoGo = runChecked(
    "adb",
    ["shell", "pm", "path", "host.exp.exponent"],
    "Checking Expo Go installation",
  );
  if (!expoGo.startsWith("package:")) throw new Error("Expo Go is not installed.");

  originalWifi = readSetting("wifi_on");
  originalAirplane = readSetting("airplane_mode_on");
  connectivityTouched = true;
  setConnectivity(true);
  runChecked(
    "adb",
    ["reverse", `tcp:${fixturePort}`, `tcp:${fixturePort}`],
    "Forwarding the local native OAuth fixture to Android",
  );
  fixtureReversed = true;

  testSessionSeeded = true;
  runMaestro("maestro/google-link-native/1-start-native-oauth.yaml");
  setConnectivity(false);
  runMaestro("maestro/google-link-native/2-offline-failure.yaml");
  setConnectivity(true);
  runMaestro("maestro/google-link-native/3-retry-success.yaml");
} catch (error) {
  console.error(`Android native Google-link retry test failed: ${error.message}`);
  failed = true;
} finally {
  if (connectivityTouched) {
    try {
      setConnectivity(true);
    } catch (error) {
      console.error(`Could not reconnect Android before cleanup (${error.message}).`);
      failed = true;
    }
  }
  if (testSessionSeeded) {
    try {
      runMaestro("maestro/google-link-native/restore-session.yaml");
      console.log("Restored Daily007's saved session from before the native Google-link test.");
    } catch (error) {
      console.error(`Could not restore the previous Daily007 session (${error.message}).`);
      failed = true;
    }
  }
  if (fixtureReversed) {
    try {
      runChecked("adb", ["reverse", "--remove", `tcp:${fixturePort}`], "Removing the OAuth fixture port forwarding");
    } catch (error) {
      console.error(`Could not remove Android's temporary OAuth fixture port forwarding (${error.message}).`);
      failed = true;
    }
  }
  if (originalAirplane !== undefined && originalWifi !== undefined) {
    try {
      setAirplaneModeEnabled(originalAirplane === "1");
      setWifiEnabled(originalWifi === "1");
      console.log("Restored Android's original airplane-mode and Wi-Fi settings.");
    } catch (error) {
      console.error(`Could not restore Android's original network settings (${error.message}).`);
      failed = true;
    }
  }
}

if (failed) process.exitCode = 1;
