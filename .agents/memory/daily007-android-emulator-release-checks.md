---
name: Daily007 Android emulator release checks
description: Hosted GitHub Actions status for the tournament join-recovery Maestro release checks.
---

The user confirmed that the GitHub Actions Android emulator release workflow passed, including the tournament join-recovery checks.

**Why:** This confirms that the hosted emulator setup works, beyond local static and regression checks.

**How to apply:** Keep the emulator workflow as an Android release gate. Check the actual Actions run if future emulator failures need diagnosis.

## Emulator action shell semantics

`reactivecircus/android-emulator-runner` splits its `script` input on newlines and executes each line in a separate `sh -c` process. Use one input line to invoke a checked-in Bash script whenever commands share variables, functions, traps, or background processes.

**Why:** Multiline inline scripts lose assignments and shell options between lines, then fail before producing diagnostics. Checking the entire inline block with `sh -n` does not reproduce the action's execution semantics.

**How to apply:** Test through the action's single-line invocation and verify cleanup and failure handling. Do not infer Expo Go installation or emulator-to-Metro connectivity from APK download success.

## Fixture health-probe ordering

Keep additional local-fixture health probes after Metro has started and passed its host readiness check. The emulator workflow test's `curl` stub deliberately waits for Metro before returning; an earlier fixture probe will stall the whole shell.

**Why:** A pre-Metro curl call deadlocks the mocked release script even when the fixture server itself is healthy.

**How to apply:** Select and export fixture configuration before starting Metro, but launch the fixture server and probe it only after Metro readiness.

## Maestro flow variable forwarding

Environment variables in the CI shell are not automatically available as Maestro flow variables. Pass values referenced as `${NAME}` in flow YAML explicitly with Maestro's `-e NAME=value` option.

**Why:** The Android workflow reached Metro successfully, but `openLink` received `undefined` for the Expo URL and Android could not resolve the intent.

**How to apply:** When Maestro tests run through package scripts or Node helpers, ensure the CLI invocation receives the flow variables, not merely the parent process environment.

## Expo Go cold-start UI checks

Run Maestro flows serially on one emulator. Metro reporting `Android Bundled` only confirms host bundling; assert client readiness from the actual fixture UI. If Expo Go stays on its native splash with no runtime error, collect the screen hierarchy and screenshot instead of assuming the bundle or an optional `Wait` tap fixed it.

**Why:** Hosted runs completed Metro bundling in roughly 42–55 seconds but still showed Expo Go's “Splash Screen Image”; later runs had no Pixel Launcher dialog or matching runtime errors. A successful host bundle does not prove the app executed.

**How to apply:** Keep flows serial, but use the first failed test's screenshot, screen hierarchy, Metro tail, and device logcat to diagnose a splash-only launch. Do not treat a bundle-complete message as a passed UI test.

## Long Android 35 emulator sessions

Keep the Android 35 Maestro workload in several shorter emulator sessions rather than one long-lived session; preserve every suite while grouping related checks.

**Why:** Hosted CI lost `emulator-5554` from ADB late in the serial suite, without an Android fatal signal or app runtime crash. The leaderboard flow and its assertions were progressing when the device disappeared.

**How to apply:** Run core navigation/join, wallet/player, and leaderboard/account checks in separate emulator starts. Keep each group on one persistent Bash invocation so Metro and cleanup remain reliable within that session.
