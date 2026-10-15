import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = await readFile(join(root, ".github/workflows/android-release-verification.yml"), "utf8");
const commands = [...workflow.matchAll(/^ {10}script:\s*(.+)$/gm)].map((match) => match[1]);

test("each emulator action invokes one persistent Bash process, not independent input lines", () => {
  assert.deepEqual(commands, [
    "bash .github/scripts/android-emulator-verification.sh 35",
    "bash .github/scripts/android-emulator-verification.sh 36",
  ]);
  assert.match(workflow, /name: Upload Android emulator diagnostics\s+if: always\(\)/);
});

async function run(api, failStage = "") {
  const dir = await mkdtemp(join(tmpdir(), "daily007-emulator-script-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_WORKSPACE: dir,
    RUNNER_TEMP: dir,
    GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
    MOCK_CALLS: join(dir, "calls.txt"),
    MOCK_METRO_PID: join(dir, "metro.pid"),
    FAIL_STAGE: failStage,
  };
  const stubs = {
    adb: `#!/usr/bin/env bash
printf 'adb %s\\n' "$*" >> "$MOCK_CALLS"
case "$1" in
  install) [ "$FAIL_STAGE" != install ] || exit 17; echo Success ;;
  reverse) echo '8081' ;;
  shell)
    if [ "$2" = pm ]; then
      echo package:/data/app/host.exp.exponent/base.apk
    elif [ "$FAIL_STAGE" = emulator ]; then
      echo 'HTTP/1.0 503 Unavailable'
    else
      printf 'HTTP/1.0 200 OK\\r\\n\\r\\npackager-status:running'
    fi ;;
  logcat) echo 'mock logcat' ;;
esac
`,
    pnpm: `#!/usr/bin/env bash
printf 'pnpm %s\\n' "$*" >> "$MOCK_CALLS"
if [ "$3" = exec ]; then
  printf '%s' "$$" > "$MOCK_METRO_PID"
  [ "$FAIL_STAGE" != host ] || exit 23
  exec sleep 300
fi
[ "$EXPO_DEV_URL" = exp://127.0.0.1:8081 ] || exit 24
[ -d "$MAESTRO_TEST_OUTPUT_DIR" ] || exit 25
echo 'mock suite passed'
`,
    curl: `#!/usr/bin/env bash
while [ ! -f "$MOCK_METRO_PID" ]; do sleep 0.01; done
[ "$FAIL_STAGE" != host ] || exit 22
printf 'packager-status:running'
`,
  };
  for (const [name, content] of Object.entries(stubs)) {
    await writeFile(join(bin, name), content, { mode: 0o755 });
  }
  try {
    // Same invocation semantics as android-emulator-runner's sh -c per input line.
    const result = spawnSync("sh", ["-c", `bash .github/scripts/android-emulator-verification.sh ${api}`], {
      cwd: root, env, encoding: "utf8", timeout: 15_000,
    });
    assert.ifError(result.error);
    const diagnostics = join(dir, "android-emulator-diagnostics", api === 36 ? "api-36" : "");
    const calls = await readFile(env.MOCK_CALLS, "utf8").catch(() => "");
    const exists = async (file) => readFile(join(diagnostics, file), "utf8").catch(() => null);
    const pid = await readFile(env.MOCK_METRO_PID, "utf8").catch(() => "");
    if (pid) {
      assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" }, "Metro must be stopped by EXIT cleanup");
    }
    return {
      ...result, calls,
      verified: await exists("setup-verified.txt"),
      exit: await exists("runner-exit.txt"),
      logcat: await exists("android-logcat.txt"),
      install: await exists("expo-go-install.log"),
      failureDetails: await exists("failure-details.txt"),
      output: result.stdout + result.stderr,
      summary: await readFile(env.GITHUB_STEP_SUMMARY, "utf8").catch(() => ""),
    };
  } finally {
    // Also clean up a leaked mock server if a regression prevented the EXIT trap.
    const pid = await readFile(env.MOCK_METRO_PID, "utf8").catch(() => "");
    if (pid) { try { process.kill(Number(pid)); } catch {} }
    await rm(dir, { recursive: true, force: true });
  }
}

for (const api of [35, 36]) {
  test(`API ${api}: install, host/emulator Metro probes, suites and cleanup persist in one shell`, async () => {
    const result = await run(api);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.install, /Success/);
    assert.match(result.verified, /host and emulator both reached/);
    assert.match(result.summary, /Expo Go installed successfully/);
    assert.match(result.calls, /adb shell pm path host.exp.exponent/);
    assert.match(result.calls, /adb reverse tcp:8081 tcp:8081/);
    assert.match(result.calls, /test:android-join-form-accessibility/);
    const suites = result.calls.split("\n").filter((line) => line.startsWith("pnpm") && line.includes(" run "));
    assert.equal(suites.length, api === 35 ? 9 : 1);
    assert.equal(result.exit, "exit_status=0\n");
    assert.match(result.logcat, /mock logcat/);
  });
}

test("install failure preserves its exit status, log and cleanup without starting Metro", async () => {
  const result = await run(35, "install");
  assert.equal(result.status, 17);
  assert.equal(result.exit, "exit_status=17\n");
  assert.equal(result.verified, null);
  assert.doesNotMatch(result.calls, /pnpm/);
  assert.match(result.logcat, /mock logcat/);
  assert.match(result.failureDetails, /phase=install Expo Go APK/);
  assert.match(result.output, /Phase 'install Expo Go APK' failed/);
});

for (const stage of ["host", "emulator"]) {
  test(`${stage} Metro failure does not claim setup success or start suites`, async () => {
    const result = await run(35, stage);
    assert.equal(result.status, 1);
    assert.equal(result.exit, "exit_status=1\n");
    assert.equal(result.verified, null);
    assert.doesNotMatch(result.calls, /pnpm .* run /);
    assert.match(result.summary, /Android API 35 emulator failure/);
    assert.doesNotMatch(result.summary, /Expo Go installed successfully/);
    assert.match(result.failureDetails, stage === "host"
      ? /phase=Metro did not become ready on host port 8081/
      : /phase=validate emulator Metro response/);
    assert.match(result.output, /::error title=Android API 35 emulator failure::/);
  });
}
