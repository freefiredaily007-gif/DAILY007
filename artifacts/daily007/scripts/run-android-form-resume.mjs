import { spawnSync } from "node:child_process";

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error("Set EXPO_DEV_URL to the Expo development server URL before running this Android test.");
  process.exit(2);
}

const devicesResult = spawnSync("adb", ["devices", "-l"], { encoding: "utf8" });
if (devicesResult.error || devicesResult.status !== 0) {
  console.error(`Could not list Android devices: ${devicesResult.error?.message || devicesResult.stderr?.trim() || "adb failed"}`);
  process.exit(devicesResult.status ?? 1);
}
const devices = (devicesResult.stdout ?? "")
  .split(/\r?\n/)
  .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
if (devices.length !== 1) {
  console.error(`Expected exactly one authorized Android device or emulator; found ${devices.length}.`);
  process.exit(2);
}

const args = ["test"];
if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
  args.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
}
args.push("maestro/form-resume/forms-retain-values-after-background.yaml");
const result = spawnSync("maestro", args, {
  stdio: "inherit",
  env: { ...process.env, EXPO_DEV_URL: expoDevUrl },
});
if (result.error || result.status !== 0) {
  console.error(`Android form background/resume check failed: ${result.error?.message || `exit code ${result.status ?? "unknown"}`}`);
  process.exitCode = result.status ?? 1;
}
