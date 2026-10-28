---
name: Android 35 airplane-mode CI
description: Change airplane mode in Android emulator scripts without sending a protected broadcast from the shell UID.
---

Android 35 rejects `adb shell am broadcast -a android.intent.action.AIRPLANE_MODE` with a `SecurityException`. Use `adb shell cmd connectivity airplane-mode enable` or `disable`, then read and verify the airplane-mode setting.

The Wi-Fi setting can briefly report a transitional value such as `2` after `svc wifi enable`; poll for the requested stable state rather than rejecting the transition immediately.

**Why:** CI cleanup for native session-recovery tests failed when the shell UID attempted to send the protected airplane-mode broadcast. A later run also aborted when a transient Wi-Fi setting value was treated as malformed.

**How to apply:** Use the ConnectivityService shell command in Android emulator scripts, poll until airplane mode and Wi-Fi reach their requested stable states, preserve cleanup that restores original settings, and fail explicitly if they do not settle within the timeout.
