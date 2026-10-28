---
name: Android 35 airplane-mode CI
description: Change airplane mode in Android emulator scripts without sending a protected broadcast from the shell UID.
---

Android 35 rejects `adb shell am broadcast -a android.intent.action.AIRPLANE_MODE` with a `SecurityException`. Use `adb shell cmd connectivity airplane-mode enable` or `disable`, then read and verify the airplane-mode setting.

**Why:** CI cleanup for native session-recovery tests failed when the shell UID attempted to send the protected airplane-mode broadcast, leaving the release gate red.

**How to apply:** Use the ConnectivityService shell command in Android emulator scripts, preserve cleanup that restores original airplane-mode and Wi-Fi settings, and fail explicitly if the command or verification does not succeed.
