# Android saved-session recovery checks

These Maestro flows use the development-only `/session-verification-test` route. The fixture runs the same saved-session restore helper, native connectivity/app-state recovery listener, and paused-session component as Daily007. It uses an in-memory test session and simulated verification responses; it does not call the API or write to account storage.

The Android runner temporarily enables airplane mode and disables Wi-Fi through ADB, then restores both original settings. Using airplane mode also disables mobile data where available. It requires exactly one authorized Android device or emulator, Expo Go, Maestro, an available Expo development server, and working Wi-Fi with internet access before the run:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-session-verification
```

The run reconnects while the paused screen is open, reconnects while the app is in the background and then foregrounds it, and tests two simulated HTTP 503 responses followed by a successful user retry. **Retry is never tapped** in either reconnect flow. The runner restores the device's original airplane-mode and Wi-Fi settings even when a flow fails.

The Android release verification workflow runs this suite on its Android emulator. For a physical-device spot check, use an Android 16 device with Expo Go, connect the device to the development server, and follow this checklist:

## Device checklist

1. Start the route with Wi-Fi disabled and confirm `SESSION VERIFICATION PAUSED` plus the saved fixture token.
2. Restore Wi-Fi without touching Retry. Confirm the fixture says `Verified without tapping Retry`.
3. Disable Wi-Fi, reopen the route, press Home, restore Wi-Fi while it is backgrounded, then reopen Expo Go. Confirm it verifies without a Retry tap.
4. Open the `transient` scenario while online. Confirm the session token remains visible after the failed attempts, then tap Retry and confirm verification completes.
5. Restore the original Wi-Fi setting when done.

If the Android device policy or test runner prevents ADB from toggling Wi-Fi, keep the device steps manual and record which reconnect/resume path was checked; do not treat a run without a confirmed Wi-Fi state change as passing.
