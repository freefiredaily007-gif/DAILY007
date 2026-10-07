# Android tournament join rejection tests

These Maestro flows open the development-only `/join-recovery-test` route. The route uses local fixture data and simulated API errors; it does not send requests, charge coins, or write registrations.

Run with an Android device or emulator that has Expo Go installed and can reach the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-join-recovery
```

`EXPO_DEV_URL` is the `exp://` base URL shown by Expo CLI, without the `/--/join-recovery-test` path. These tests are separate from the browser-based Node regression test.

The Android release verification workflow runs both flows on an Android emulator for pull requests to `main`, pushes to `main`, version tags, and manual runs. It uses Expo Go `57.0.9` for the app's current Expo SDK 57; update `EXPO_GO_VERSION` in `.github/workflows/android-release-verification.yml` when the app's Expo SDK changes.
