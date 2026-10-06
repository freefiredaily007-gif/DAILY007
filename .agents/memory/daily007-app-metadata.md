---
name: Daily007 installed app metadata
description: Correct source for installed app version and build readouts in the SDK 57 mobile app.
---

Use `nativeApplicationVersion` and `nativeBuildVersion` from `expo-application` for values that identify the installed Daily007 binary. Expo SDK 57 deprecates the equivalent native fields on `expo-constants`; Android's native module reads the package's version name and version code. If native values are unavailable, `Constants.expoConfig` is a useful embedded-config fallback for web and Expo Go previews.

**Why:** The readout must describe the installed app, not the workspace package version or a manually maintained display string.

**How to apply:** Prefer native metadata for in-app build reporting. Treat `app.json` as the expected build configuration, not as proof of what is installed; confirm the standalone binary on-device when that distinction matters.
