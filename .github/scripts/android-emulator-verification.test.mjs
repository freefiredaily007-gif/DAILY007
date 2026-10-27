import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const { installCiDevToolsShellOverride } = require("./disable-rn-devtools-shell.cjs");
const workflow = await readFile(join(root, ".github/workflows/android-release-verification.yml"), "utf8");
const emulatorScript = await readFile(join(root, ".github/scripts/android-emulator-verification.sh"), "utf8");
const rootLayout = await readFile(join(root, "artifacts/daily007/app/_layout.tsx"), "utf8");
const daily007Package = JSON.parse(await readFile(join(root, "artifacts/daily007/package.json"), "utf8"));
const commands = [...workflow.matchAll(/^ {10}script:\s*(.+)$/gm)].map((match) => match[1]);
const setupDiagnosticsScript = join(root, ".github/scripts/android-emulator-setup-diagnostics.sh");

test("join-recovery flows handle Expo Go prompts and the native developer menu", async () => {
  const command = daily007Package.scripts["test:android-join-recovery"];
  assert.equal((command.match(/maestro test/g) ?? []).length, 3);
  assert.match(
    command,
    /insufficient-balance\.yaml[\s\S]*&& maestro test[\s\S]*last-slot-taken\.yaml[\s\S]*&& maestro test[\s\S]*local-validation\.yaml/,
  );
  assert.equal((command.match(/EXPO_DEV_URL=\$EXPO_DEV_URL/g) ?? []).length, 3);
  for (const flowName of ["insufficient-balance", "last-slot-taken", "local-validation"]) {
    const flow = await readFile(
      join(root, `artifacts/daily007/maestro/join-recovery/${flowName}.yaml`),
      "utf8",
    );
    assert.match(flow, /repeat:\n\s+times: 12\n\s+while:\n\s+notVisible:\n\s+id: join-recovery-fixture-banner/);
    assert.match(flow, /id: android:id\/aerr_wait\n\s+optional: true/);
    assert.doesNotMatch(flow, /id: android:id\/aerr_wait[\s\S]{0,100}waitUntilVisible: true/);
    assert.match(flow, /text: Continue\n\s+optional: true\n\s+waitUntilVisible: true/);
    assert.match(flow, /when:\n\s+visible: Continue\n\s+commands:\n\s+- pressKey: BACK/);
    assert.match(flow, /when:\n\s+visible: Reload\n\s+commands:\n\s+- pressKey: BACK/);
    assert.match(flow, /id: join-recovery-fixture-banner\n\s+timeout: 60000/);
  }
});

test("each emulator action invokes one persistent Bash process, not independent input lines", () => {
  assert.deepEqual(commands, [
    "bash .github/scripts/android-emulator-verification.sh 35",
    "bash .github/scripts/android-emulator-verification.sh 36",
  ]);
  assert.match(workflow, /name: Upload Android emulator diagnostics\s+if: always\(\)/);
  assert.match(workflow, /id: emulator_api_35[\s\S]*?Capture Android 35 setup failure diagnostics\s+if: \$\{\{ failure\(\) && steps\.emulator_api_35\.outcome == 'failure' \}\}[\s\S]*?android-emulator-setup-diagnostics\.sh 35 5554/);
  assert.match(workflow, /id: emulator_api_36[\s\S]*?Capture Android 36 setup failure diagnostics\s+if: \$\{\{ failure\(\) && steps\.emulator_api_36\.outcome == 'failure' \}\}[\s\S]*?android-emulator-setup-diagnostics\.sh 36 5554/);
});

test("Android join-recovery CI can hide the splash without waiting for custom fonts", () => {
  assert.match(emulatorScript, /EXPO_PUBLIC_ANDROID_JOIN_RECOVERY_TEST=1/);
  assert.match(rootLayout, /EXPO_PUBLIC_ANDROID_JOIN_RECOVERY_TEST === '1'/);
  assert.match(rootLayout, /fontsLoaded \|\| fontError \|\| androidJoinRecoverySmokeTest/);
  assert.match(rootLayout, /!fontsLoaded && !fontError && !androidJoinRecoverySmokeTest/);
  assert.match(rootLayout, /<Stack\.Screen name="join-recovery-test" \/>/);
});

test("headless CI disables only the optional standalone React Native DevTools shell", () => {
  const devMiddleware = {
    createDevMiddleware(options) {
      return options;
    },
    untouchedExport: "preserved",
  };
  const moduleLoader = {
    _load(request) {
      return request === "@react-native/dev-middleware" ? devMiddleware : { other: true };
    },
  };

  assert.equal(installCiDevToolsShellOverride(moduleLoader, true), true);
  const intercepted = moduleLoader._load("@react-native/dev-middleware");
  const result = intercepted.createDevMiddleware({
    serverBaseUrl: "http://localhost:8081",
    unstable_experiments: {
      enableNetworkInspector: true,
      enableStandaloneFuseboxShell: true,
    },
  });
  assert.equal(result.unstable_experiments.enableNetworkInspector, true);
  assert.equal(result.unstable_experiments.enableStandaloneFuseboxShell, false);
  assert.equal(intercepted.untouchedExport, "preserved");
  assert.deepEqual(moduleLoader._load("other-package"), { other: true });

  const localLoader = { _load: () => devMiddleware };
  const originalLoad = localLoader._load;
  assert.equal(installCiDevToolsShellOverride(localLoader, false), false);
  assert.equal(localLoader._load, originalLoad);
});

test("Android emulator Metro loads the headless-only DevTools override", () => {
  assert.match(
    emulatorScript,
    /NODE_OPTIONS=.*disable-rn-devtools-shell\.cjs/,
  );
  assert.match(emulatorScript, /NODE_OPTIONS=.*--dns-result-order=ipv4first/);
  assert.match(emulatorScript, /CI=1/);
});

test("published PWA cache and offline smoke is a blocking workflow check separate from manifest installability", () => {
  assert.match(workflow, /^  published-pwa-cache-smoke:\n/m);
  assert.match(workflow, /name: Published PWA cache and offline check/);
  const publishedPwaJob = workflow
    .split("\n  published-pwa-cache-smoke:\n")[1]
    ?.split("\n  published-pwa-installability:\n")[0];
  assert.ok(publishedPwaJob, "The published PWA cache job should exist in the release workflow.");
  assert.match(
    publishedPwaJob,
    /DAILY007_PUBLISHED_URL: https:\/\/daily-007-source-1-zip\.replit\.app\/?/,
  );
  assert.match(
    publishedPwaJob,
    /run: pnpm --filter @workspace\/daily007 run test:pwa:published:browser -- "\$DAILY007_PUBLISHED_URL"/,
  );
  assert.match(publishedPwaJob, /CHROMIUM_PATH: \$\{\{ steps\.chromium\.outputs\.chrome-path \}\}/);
  assert.match(publishedPwaJob, /Manifest installability checks remain the separate test:pwa:published command\./);
  assert.doesNotMatch(publishedPwaJob, /continue-on-error:\s*true|test:pwa:published:browser[^\n]*\|\|\s*true/);
  assert.doesNotMatch(publishedPwaJob, /test:pwa:published:installability/);
  assert.doesNotMatch(
    publishedPwaJob,
    /run: pnpm --filter @workspace\/daily007 run test:pwa:published --/,
  );
});

test("published PWA installability has its own non-cache desktop Chromium check", () => {
  const installabilityJob = workflow
    .split("\n  published-pwa-installability:\n")[1]
    ?.split("\n  tournament-join-recovery:\n")[0];
  assert.ok(installabilityJob, "The published PWA installability job should exist in the release workflow.");
  assert.match(installabilityJob, /name: Published PWA installability \(desktop Chromium\)/);
  assert.match(
    installabilityJob,
    /run: pnpm --filter @workspace\/daily007 run test:pwa:published:installability -- "\$DAILY007_PUBLISHED_URL"/,
  );
  assert.match(installabilityJob, /CHROMIUM_PATH: \$\{\{ steps\.chromium\.outputs\.chrome-path \}\}/);
  assert.doesNotMatch(installabilityJob, /test:pwa:published:browser|test:pwa:published --/);
  assert.doesNotMatch(installabilityJob, /continue-on-error:\s*true/);
});

async function runSetupDiagnostics(api, testScriptStarted = false) {
  const dir = await mkdtemp(join(tmpdir(), "daily007-emulator-setup-"));
  const bin = join(dir, "bin");
  const workspace = join(dir, "workspace");
  const diagnostics = join(workspace, "android-emulator-diagnostics");
  await mkdir(bin);
  await mkdir(diagnostics, { recursive: true });
  if (testScriptStarted) {
    const marker = api === 36
      ? join(diagnostics, "api-36", "runner-started.txt")
      : join(diagnostics, "runner-started.txt");
    await mkdir(join(marker, ".."), { recursive: true });
    await writeFile(marker, "runner reached the test script\n");
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_WORKSPACE: workspace,
    ANDROID_HOME: dir,
  };
  const stubs = {
    emulator: `#!/usr/bin/env bash
if [ "$1" = "-version" ]; then echo 'Android emulator version 35.1'; else echo 'test-avd'; fi
`,
    sdkmanager: `#!/usr/bin/env bash
printf 'emulator;35.1\\nplatform-tools;35.0\\nplatforms;android-${api}\\nsystem-images;android-${api};google_apis;x86_64\\n'
`,
    adb: `#!/usr/bin/env bash
case "$*" in
  *logcat*) printf 'Authorization: Bearer sentinel-bearer\\npassword=sentinel-password\\n' ;;
  *get-state*) echo device ;;
  *getprop*) printf '1\\n${api}\\n' ;;
  *) echo 'List of devices attached' ;;
esac
`,
  };
  for (const [name, content] of Object.entries(stubs)) {
    await writeFile(join(bin, name), content, { mode: 0o755 });
  }
  try {
    const result = spawnSync("bash", [setupDiagnosticsScript, String(api), "5554"], {
      cwd: root, env, encoding: "utf8",
    });
    assert.ifError(result.error);
    const setupDir = join(diagnostics, `api-${api}-setup`);
    const fileNames = await readdir(setupDir).catch(() => []);
    const diagnosticFiles = Object.fromEntries(await Promise.all(fileNames.map(async (file) => [
      file, await readFile(join(setupDir, file), "utf8"),
    ])));
    return {
      ...result,
      diagnostics,
      diagnosticFiles,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("setup diagnostics capture boot evidence and redact credentials before artifact output", async () => {
  const result = await runSetupDiagnostics(35);
  assert.equal(result.status, 0, result.stderr);
  const logcat = result.diagnosticFiles["emulator-boot-logcat.txt"];
  assert.match(logcat, /Authorization: .*REDACTED/);
  assert.match(logcat, /password=\[REDACTED\]/);
  const files = Object.keys(result.diagnosticFiles);
  assert.ok(files.includes("emulator-state.txt"));
  assert.ok(files.includes("emulator-boot-properties.txt"));
  assert.ok(files.includes("sdk-packages.txt"));
  for (const file of files) {
    const content = result.diagnosticFiles[file];
    assert.doesNotMatch(content, /sentinel-(?:bearer|password)/);
    assert.doesNotMatch(content, /\.raw(?:\n|$)/);
  }
  const context = result.diagnosticFiles["setup-context.txt"];
  assert.match(context, /original emulator action error remains in the workflow log/);
});

test("API 36 setup failure diagnostics stay isolated to API 36", async () => {
  const result = await runSetupDiagnostics(36);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.diagnosticFiles["emulator-boot-logcat.txt"]);
  assert.match(result.diagnosticFiles["setup-context.txt"], /api_level=36/);
  assert.deepEqual(Object.keys(result.diagnosticFiles).filter((file) => /api-35/.test(file)), []);
});

test("setup diagnostics are not created after the test script has started", async () => {
  const result = await runSetupDiagnostics(36, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /test script started; skipping setup-only diagnostics/);
  assert.deepEqual(result.diagnosticFiles, {});
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
    ANDROID_METRO_STARTUP_TIMEOUT_SECONDS: failStage === "metro-stalled" ? "2" : "360",
  };
  const stubs = {
    adb: `#!/usr/bin/env bash
printf 'adb %s\\n' "$*" >> "$MOCK_CALLS"
case "$1" in
  install) [ "$FAIL_STAGE" != install ] || exit 17; echo Success ;;
  reverse)
    if [ "$2" = --list ]; then
      echo "emulator-5554 tcp:$METRO_PORT tcp:$METRO_PORT"
    else
      echo "$3 $4"
    fi ;;
  shell)
    if [ "$2" = pm ]; then
      echo package:/data/app/host.exp.exponent/base.apk
    fi
    if [ "$2" = settings ] && [ "$3" = get ] && [ "$4" = global ] && [ "$5" = anr_show_background ]; then
      if [ "$FAIL_STAGE" = anr-setting ]; then echo 1; else echo 0; fi
    fi ;;
  logcat) echo 'mock logcat' ;;
esac
`,
    ps: `#!/usr/bin/env bash
printf 'mock ps %s\\n' "$*"
`,
    ss: `#!/usr/bin/env bash
printf 'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\\n'
if [ "$FAIL_STAGE" != host ] && [ "$FAIL_STAGE" != metro-stalled ]; then
  printf 'LISTEN 0 128 127.0.0.1:%s 0.0.0.0:* users:(("mock-metro",pid=1,fd=3))\\n' "$METRO_PORT"
fi
`,
    pnpm: `#!/usr/bin/env bash
printf 'pnpm %s\\n' "$*" >> "$MOCK_CALLS"
if [ "$3" = exec ]; then
  printf '%s' "$$" > "$MOCK_METRO_PID"
  printf 'NODE_OPTIONS %s\\n' "$NODE_OPTIONS" >> "$MOCK_CALLS"
  if [ "$FAIL_STAGE" = host ]; then
    echo 'Metro startup failed: EADDRINUSE' >&2
    exit 23
  fi
  exec sleep 300
fi
[ "$EXPO_DEV_URL" = "exp://127.0.0.1:$METRO_PORT" ] || exit 24
[ -d "$MAESTRO_TEST_OUTPUT_DIR" ] || exit 25
maestro test sample-flow.yaml
maestro test -e "EXPO_DEV_URL=$EXPO_DEV_URL" sample-flow-with-env.yaml
[ "$FAIL_STAGE" != maestro ] || {
  mkdir -p "$MAESTRO_TEST_OUTPUT_DIR/join-recovery/logs" "$MAESTRO_TEST_OUTPUT_DIR/join-recovery/screen-hierarchy"
  echo 'Maestro failure: join-recovery fixture not visible' > "$MAESTRO_TEST_OUTPUT_DIR/join-recovery/logs/maestro.log"
  printf 'E ReactNativeJS: Error: simulated startup failure\nActivityManager: ANR in com.google.android.apps.nexuslauncher\n' > "$MAESTRO_TEST_OUTPUT_DIR/join-recovery/logs/device-logcat.txt"
  echo '{"elements":[{"text":"Could not connect to Metro","resourceId":"join-recovery-fixture-banner"}]}' > "$MAESTRO_TEST_OUTPUT_DIR/join-recovery/screen-hierarchy/step.json"
  echo 'mock Maestro could not load Expo Go URL' >&2
  exit 26
}
echo 'mock suite passed'
`,
    curl: `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$MOCK_CALLS"
while [ ! -f "$MOCK_METRO_PID" ]; do sleep 0.01; done
if [[ " $* " == *" --verbose "* ]]; then
  echo 'curl: (7) Failed to connect to Metro: Connection refused' >&2
  exit 7
fi
[ "$FAIL_STAGE" != host ] && [ "$FAIL_STAGE" != metro-stalled ] || exit 22
printf 'packager-status:running'
`,
    maestro: `#!/usr/bin/env bash
printf 'maestro %s\\n' "$*" >> "$MOCK_CALLS"
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
      hostReady: await exists("host-ready.txt"),
      exit: await exists("runner-exit.txt"),
      logcat: await exists("android-logcat.txt"),
      install: await exists("expo-go-install.log"),
      failureDetails: await exists("failure-details.txt"),
      hostDiagnostics: await exists("metro-host-diagnostics.txt"),
      metroProcess: await exists("metro-process.txt"),
      metroListeners: await exists("metro-port-listeners.txt"),
      metroIpv4Probe: await exists("metro-status-ipv4.curl.txt"),
      metroIpv4ProbeLog: await exists("metro-status-ipv4.curl.log"),
      metroLocalhostProbe: await exists("metro-status-localhost.curl.txt"),
      metroLocalhostProbeLog: await exists("metro-status-localhost.curl.log"),
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
  test(`API ${api}: install, host Metro readiness, ADB reverse, Maestro suites and cleanup persist in one shell`, async () => {
    const result = await run(api);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.install, /Success/);
    assert.match(result.hostReady, /host Metro reached packager-status:running and adb reverse was configured on port \d+/);
    assert.match(result.summary, /Expo Go installed successfully/);
    assert.match(result.summary, /ADB reverse configured; Maestro flows will verify app connectivity/);
    const anrSetting = result.calls.indexOf("adb shell settings put global anr_show_background 0");
    const expoGoInstall = result.calls.indexOf("adb install -r");
    assert.ok(anrSetting >= 0 && anrSetting < expoGoInstall, "background ANR dialogs must be disabled before app startup");
    assert.match(result.calls, /adb shell settings get global anr_show_background/);
    assert.match(result.calls, /adb shell pm path host.exp.exponent/);
    const metroPort = result.calls.match(/adb reverse tcp:(\d+) tcp:\1/)?.[1];
    assert.ok(metroPort, "adb reverse must use the dynamically selected Metro port");
    assert.match(result.calls, new RegExp(`pnpm .*--port ${metroPort}`));
    assert.match(result.calls, /NODE_OPTIONS .*--dns-result-order=ipv4first/);
    assert.match(result.calls, new RegExp(`curl --noproxy \\* --connect-timeout 1 --max-time 3 --fail --silent http://localhost:${metroPort}/status`));
    assert.doesNotMatch(result.calls, /toybox nc/);
    assert.match(result.calls, new RegExp(`maestro test -e EXPO_DEV_URL=exp:\\/\\/127\\.0\\.0\\.1:${metroPort} sample-flow\\.yaml`));
    assert.match(result.calls, new RegExp(`maestro test -e EXPO_DEV_URL=exp:\\/\\/127\\.0\\.0\\.1:${metroPort} sample-flow-with-env\\.yaml`));
    assert.doesNotMatch(result.calls, /maestro test -e EXPO_DEV_URL=[^\\s]+ -e EXPO_DEV_URL=/);
    assert.match(result.calls, /test:android-join-form-accessibility/);
    const suites = result.calls.split("\n").filter((line) => line.startsWith("pnpm") && line.includes(" run "));
    assert.equal(suites.length, api === 35 ? 14 : 2);
    const metroReverseCalls = result.calls
      .split("\n")
      .filter((line) => line === `adb reverse tcp:${metroPort} tcp:${metroPort}`);
    assert.equal(
      metroReverseCalls.length,
      suites.length + 1,
      "restore Metro forwarding before every Maestro suite in addition to initial setup",
    );
    if (api === 35) {
      assert.match(result.calls, /test:android-join-recovery/);
      assert.match(result.calls, /test:android-google-link-retry/);
      assert.match(result.calls, /test:android-wallet-payment-history/);
    }
    assert.equal(result.exit, "exit_status=0\n");
    assert.match(result.logcat, /mock logcat/);
  });
}

test("background ANR suppression must be verified before launching Metro", async () => {
  const result = await run(35, "anr-setting");
  assert.equal(result.status, 1);
  assert.equal(result.exit, "exit_status=1\n");
  assert.match(result.failureDetails, /phase=suppress background ANR dialogs in the headless emulator/);
  assert.match(result.output, /Expected anr_show_background=0/);
  assert.doesNotMatch(result.calls, /adb install -r|pnpm .*--port/);
});

test("install failure preserves its exit status, log and cleanup without starting Metro", async () => {
  const result = await run(35, "install");
  assert.equal(result.status, 17);
  assert.equal(result.exit, "exit_status=17\n");
  assert.equal(result.hostReady, null);
  assert.doesNotMatch(result.calls, /pnpm/);
  assert.match(result.logcat, /mock logcat/);
  assert.match(result.failureDetails, /phase=install Expo Go APK/);
  assert.match(result.output, /Phase 'install Expo Go APK' failed/);
});

for (const stage of ["host", "maestro"]) {
  test(`${stage} failure preserves readiness state and does not continue later suites`, async () => {
    const result = await run(35, stage);
    const expectedStatus = stage === "host" ? 1 : 26;
    assert.equal(result.status, expectedStatus);
    assert.equal(result.exit, `exit_status=${expectedStatus}\n`);
    assert.equal(result.hostReady !== null, stage === "maestro");
    assert.match(result.summary, /Android API 35 emulator failure/);
    assert.match(result.failureDetails, stage === "host"
      ? /phase=Metro did not become ready on host port \d+/
      : /phase=Maestro suite join-recovery/);
    if (stage === "host") {
      assert.doesNotMatch(result.summary, /Expo Go installed successfully/);
      assert.doesNotMatch(result.calls, /pnpm .* run /);
    } else {
      assert.match(result.summary, /Host Metro reached `packager-status:running`/);
      assert.match(result.output, /mock Maestro could not load Expo Go URL/);
      assert.match(result.failureDetails, /Maestro logs: join-recovery\/logs\/maestro\.log: Maestro failure: join-recovery fixture not visible/);
      assert.match(result.failureDetails, /device runtime errors: join-recovery\/logs\/device-logcat\.txt: E ReactNativeJS: Error: simulated startup failure/);
      assert.match(result.failureDetails, /ActivityManager: ANR in com\.google\.android\.apps\.nexuslauncher/);
      assert.match(result.failureDetails, /screen text: join-recovery\/screen-hierarchy\/step\.json: text=Could not connect to Metro/);
      assert.match(result.failureDetails, /resourceId=join-recovery-fixture-banner/);
      assert.match(result.failureDetails, /ADB reverse mappings: emulator-5554 tcp:\d+ tcp:\d+/);
      assert.match(result.calls, /adb reverse --list/);
      assert.match(result.calls, /test:android-join-recovery/);
      assert.doesNotMatch(result.calls, /test:android-join-form-accessibility/);
    }
    assert.match(result.output, /::error title=Android API 35 emulator failure::/);
    if (stage === "host") {
      assert.match(result.output, /Metro startup failed: EADDRINUSE/);
      assert.match(result.hostDiagnostics, /Node localhost resolution:/);
      assert.match(result.hostDiagnostics, /HTTP localhost probe:/);
      assert.match(result.hostDiagnostics, /HTTP 127\.0\.0\.1 probe:/);
    }
  });
}

test("Metro readiness timeout captures process, port, and loopback status diagnostics", async () => {
  const result = await run(35, "metro-stalled");
  assert.equal(result.status, 1);
  assert.equal(result.exit, "exit_status=1\n");
  assert.match(result.failureDetails, /Metro did not become ready on host port \d+/);
  assert.match(result.metroProcess, /metro_process_status=running/);
  assert.match(result.metroProcess, /mock ps/);
  assert.match(result.metroListeners, /Local Address:Port/);
  assert.match(result.metroIpv4Probe, /curl_exit=7/);
  assert.match(result.metroIpv4ProbeLog, /Connection refused/);
  assert.match(result.metroLocalhostProbe, /curl_exit=7/);
  assert.match(result.metroLocalhostProbeLog, /Connection refused/);
  assert.match(result.output, /Metro process diagnostics:/);
  assert.match(result.output, /Metro port listeners:/);
  assert.match(result.output, /Metro ipv4 \/status probe:/);
  assert.match(result.output, /Metro localhost \/status probe:/);
  assert.doesNotMatch(result.calls, /pnpm .* run /);
});
