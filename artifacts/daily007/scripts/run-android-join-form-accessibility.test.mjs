import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runnerPath = fileURLToPath(
  new URL("./run-android-join-form-accessibility.mjs", import.meta.url),
);

test("a missing native label reports the Android API level that failed", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "join-form-maestro-"));

  try {
    const binDirectory = join(tempDirectory, "bin");
    const outputDirectory = join(tempDirectory, "maestro-output");
    const outputPath = join(tempDirectory, "maestro-args.txt");
    await mkdir(binDirectory);
    const maestroPath = join(binDirectory, "maestro");
    await writeFile(
      maestroPath,
      `#!/bin/sh
printf '%s\\n' "$@" > "$MAESTRO_ARGS_FILE"
echo "Element not found: Captain Free Fire UID" >&2
exit 1
`,
    );
    await chmod(maestroPath, 0o755);

    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ANDROID_API_LEVEL: "36",
        MAESTRO_ARGS_FILE: outputPath,
        MAESTRO_TEST_OUTPUT_DIR: outputDirectory,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Android API level 36 JoinForm accessibility label flow failed/);
    assert.match(result.stderr, /Element not found: Captain Free Fire UID/);
    assert.deepEqual((await readFile(outputPath, "utf8")).trim().split("\n"), [
      "test",
      `--test-output-dir=${outputDirectory}`,
      "maestro/join-form-accessibility",
    ]);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
