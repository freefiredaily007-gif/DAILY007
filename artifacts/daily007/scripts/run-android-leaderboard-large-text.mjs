import { spawnSync } from "node:child_process";

const expoDevUrl = process.env.EXPO_DEV_URL;
if (!expoDevUrl) {
  console.error("Set EXPO_DEV_URL to the Expo development server URL before running this Android test.");
  process.exit(2);
}

const scales = [
  { setting: "1.2", label: "1.20", layout: "compact" },
  { setting: "1.35", label: "1.35", layout: "compact" },
  { setting: "1.49", label: "1.49", layout: "compact" },
  { setting: "1.5", label: "1.50", layout: "large" },
  { setting: "2", label: "2.00", layout: "large" },
];
const cycles = [
  { name: "weekly", champion: "Weekly Champion With A Long Display Name" },
  { name: "monthly", champion: "Monthly Champion With A Long Display Name" },
];
const flowPath = "maestro/leaderboard-native-text-scale/large-text.yaml";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function runChecked(command, args, description, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`${description} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

let originalFontScale;
let fontScaleChangeAttempted = false;

try {
  const devicesOutput = runChecked("adb", ["devices", "-l"], "Listing Android devices");
  const onlineDevices = devicesOutput
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+device(?:\s|$)/.test(line));
  if (onlineDevices.length !== 1) {
    throw new Error(
      `Expected exactly one authorized Android device or emulator; found ${onlineDevices.length}. Check "adb devices -l" and disconnect additional devices.`,
    );
  }

  const expoGo = runChecked("adb", ["shell", "pm", "path", "host.exp.exponent"], "Checking Expo Go installation");
  if (!expoGo.startsWith("package:")) {
    throw new Error("Expo Go is not installed on the connected Android device or emulator.");
  }

  originalFontScale = runChecked(
    "adb",
    ["shell", "settings", "get", "system", "font_scale"],
    "Reading the current Android font scale",
  );
  if (!/^\d+(?:\.\d+)?$/.test(originalFontScale)) {
    throw new Error(`Android returned an invalid font scale: ${originalFontScale || "(empty)"}`);
  }

  for (const scale of scales) {
    fontScaleChangeAttempted = true;
    runChecked(
      "adb",
      ["shell", "settings", "put", "system", "font_scale", scale.setting],
      `Setting Android font scale to ${scale.setting}`,
    );
    const actualScale = Number(runChecked(
      "adb",
      ["shell", "settings", "get", "system", "font_scale"],
      "Verifying the Android font scale",
    ));
    if (!Number.isFinite(actualScale) || Math.abs(actualScale - Number(scale.setting)) > 0.005) {
      throw new Error(`Android did not apply font scale ${scale.setting}; it reports ${actualScale}.`);
    }

    runChecked(
      "adb",
      ["shell", "am", "force-stop", "host.exp.exponent"],
      "Restarting Expo Go for the updated font scale",
    );

    for (const cycle of cycles) {
      console.log(`Checking ${cycle.name} leaderboard at ${scale.label}× text scale.`);
      const maestroArgs = ["test"];
      if (process.env.MAESTRO_TEST_OUTPUT_DIR) {
        maestroArgs.push(`--test-output-dir=${process.env.MAESTRO_TEST_OUTPUT_DIR}`);
      }
      const maestroVariables = {
        LEADERBOARD_CYCLE: cycle.name,
        LEADERBOARD_CHAMPION: cycle.champion,
        LEADERBOARD_SCALE: scale.label,
        LEADERBOARD_LAYOUT: scale.layout,
      };
      for (const [name, value] of Object.entries(maestroVariables)) {
        maestroArgs.push("-e", `${name}=${value}`);
      }
      maestroArgs.push(flowPath);
      const result = run("maestro", maestroArgs, {
        stdio: "inherit",
        env: {
          ...process.env,
          ...maestroVariables,
        },
      });
      if (result.status !== 0) {
        throw new Error(
          `Maestro failed for the ${cycle.name} leaderboard at ${scale.label}× (exit code ${result.status ?? "unknown"}).`,
        );
      }
    }
  }
} catch (error) {
  console.error(`Android leaderboard text-scale test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (originalFontScale && fontScaleChangeAttempted) {
    const restore = run("adb", [
      "shell",
      "settings",
      "put",
      "system",
      "font_scale",
      originalFontScale,
    ]);
    if (restore.error || restore.status !== 0) {
      const detail = restore.error?.message || restore.stderr?.trim() || "unknown ADB error";
      console.error(
        `Could not restore Android font scale to ${originalFontScale} (${detail}). Restore it in Android Settings.`,
      );
      process.exitCode = 1;
    }

    if (!restore.error && restore.status === 0) {
      const restoredFontScale = run(
        "adb",
        ["shell", "settings", "get", "system", "font_scale"],
      );
      if (restoredFontScale.error || restoredFontScale.status !== 0) {
        const detail = restoredFontScale.error?.message
          || restoredFontScale.stderr?.trim()
          || "unknown ADB error";
        console.error(
          `Could not verify restoration of Android font scale to ${originalFontScale} (${detail}).`,
        );
        process.exitCode = 1;
      } else {
        const restoredScaleValue = restoredFontScale.stdout?.trim() ?? "";
        const restoredScale = Number(restoredScaleValue);
        if (
          !/^\d+(?:\.\d+)?$/.test(restoredScaleValue)
          || !Number.isFinite(restoredScale)
          || Math.abs(restoredScale - Number(originalFontScale)) > 0.005
        ) {
          console.error(
            `Android font scale was not restored: expected ${originalFontScale}, received ${restoredScaleValue || "(empty)"}.`,
          );
          process.exitCode = 1;
        }
      }
    }

    const restart = run("adb", ["shell", "am", "force-stop", "host.exp.exponent"]);
    if (restart.error || restart.status !== 0) {
      console.error("Could not restart Expo Go after restoring the Android font scale.");
      process.exitCode = 1;
    }
    if (restore.status === 0) {
      console.log(`Restored Android font scale to ${originalFontScale}.`);
    }
  }
}
