import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const apiLevel = process.env.ANDROID_API_LEVEL ?? "unknown";
const outputDirectory =
  process.env.MAESTRO_TEST_OUTPUT_DIR ?? join(homedir(), ".maestro", "tests");
const args = [
  "test",
  `--test-output-dir=${outputDirectory}`,
  "maestro/join-form-accessibility",
];

const result = spawnSync("maestro", args, { stdio: "inherit" });

if (result.error) {
  console.error(`Could not start Maestro for Android API level ${apiLevel}: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(
    `Android API level ${apiLevel} JoinForm accessibility label flow failed. ` +
      "Check the Maestro output above for the unavailable native label or field.",
  );
  process.exitCode = result.status ?? 1;
}
