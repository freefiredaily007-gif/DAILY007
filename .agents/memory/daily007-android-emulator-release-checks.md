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
