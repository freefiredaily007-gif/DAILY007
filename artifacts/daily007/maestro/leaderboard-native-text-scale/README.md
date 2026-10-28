# Android leaderboard text-scale regression

This Maestro check opens a development-only fixture route that renders the same `LeaderboardDetails` screen as the app. It uses a shared, deterministic 20-player weekly/monthly fixture and does not call the API.

The runner checks both cycles at Android font scales **1.49×**, **1.5×**, and **2×**. These cover the compact-layout edge, the compact-to-large breakpoint, and larger text. It verifies the device-reported scale, all three podium names and scores, every expanded rank 4–20 name and score, and that rank 20 can be reached by scrolling at each scale. The existing browser test continues to check text bounds and row overlap; this suite exercises the native Android text scaler and accessibility tree.

## Run on a device or emulator

Requirements:

- Android Platform-Tools with `adb` available on `PATH`
- Maestro CLI available on `PATH`
- One authorized Android device or emulator connected at a time
- Expo Go for the app's SDK 57
- The Daily007 Expo development server running and reachable from the device

Run from the repository root, using the base `exp://` URL shown by Expo CLI (without an Expo Router path):

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-leaderboard-large-text
```

The runner saves the device's current `font_scale`, applies 1.49, 1.5, and 2 for the test runs, and restores and verifies the original value in a `finally` block, including when a Maestro flow fails. It force-stops Expo Go after changing or restoring the setting so the next launch reads the updated scale. If the device disconnects before restoration, set the saved original value again in Android Settings.

The same check runs in `.github/workflows/android-release-verification.yml` on its Android emulator.
