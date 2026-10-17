import { spawnSync } from "node:child_process";

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error("Set EXPO_DEV_URL to the Expo development server URL before running this Android test.");
  process.exit(2);
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function runChecked(command, args, description) {
  const result = run(command, args);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() ||
      `exit code ${result.status ?? "unknown"}`;
    throw new Error(`${description} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function runMaestro(flow) {
  const result = run("maestro", ["test", flow]);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() ||
      `exit code ${result.status ?? "unknown"}`;
    throw new Error(`Android logout flow ${flow} failed: ${detail}`);
  }
}

const devices = runChecked("adb", ["devices"], "Checking connected Android devices")
  .split("\n")
  .slice(1)
  .filter((line) => line.trim().endsWith("\tdevice"));
if (devices.length !== 1) {
  console.error(`Expected exactly one authorized Android device or emulator; found ${devices.length}.`);
  process.exit(2);
}

try {
  runChecked("adb", ["shell", "pm", "path", "host.exp.exponent"], "Checking for Expo Go");
} catch (error) {
  console.error(`${error.message}\nExpo Go must be installed on the Android device or emulator.`);
  process.exit(2);
}

let cleanupNeeded = true;
let testFailed = false;
try {
  runMaestro("maestro/logout/delayed-success.yaml");
  runMaestro("maestro/logout/delayed-failure.yaml");
} catch (error) {
  console.error(error.message);
  testFailed = true;
} finally {
  if (cleanupNeeded) {
    try {
      runMaestro("maestro/logout/restore-session.yaml");
      cleanupNeeded = false;
      console.log("Restored the saved Daily007 session from before the native logout test.");
    } catch (error) {
      console.error(`Could not restore the previous saved session (${error.message}). Open /logout-native-test?scenario=cleanup in Expo Go while online.`);
      testFailed = true;
    }
  }
}

if (testFailed || cleanupNeeded) process.exitCode = 1;
