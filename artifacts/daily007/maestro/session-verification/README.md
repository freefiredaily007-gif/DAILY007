# Android saved-session recovery checks

These Maestro flows use the development-only `/session-verification-test` route. The fixture runs the same saved-session restore helper, native connectivity/app-state recovery listener, paused-session component, and AsyncStorage-backed session functions as Daily007. The runner first saves the current session as a local backup and seeds a deterministic test session while online, then force-stops Expo Go while connectivity is disabled. Verification responses are simulated locally; no API call or real account is used. The runner restores the prior saved session after the flows.

The Android runner temporarily enables airplane mode and disables Wi-Fi through ADB, then restores both original settings. Using airplane mode also disables mobile data where available. It requires exactly one authorized Android device or emulator, Expo Go, Maestro, an available Expo development server, and working Wi-Fi with internet access before the run:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-session-verification
```

The run seeds the test session online, disables connectivity, reboots Android, and waits for the OS to report a completed boot while confirming airplane mode and Wi-Fi are still disabled. It restores connectivity and opens the Daily007 test route; the route reads the persisted session through the app's AsyncStorage-backed functions and verifies it automatically without a Retry tap. The suite also covers force-stopping Expo Go offline, reconnecting while the paused screen is open, reconnecting while backgrounded and foregrounding the app, and two simulated HTTP 503 responses followed by a successful user retry. **Retry is never tapped** in the automatic recovery flows. The runner restores the previous saved session and the device's original airplane-mode and Wi-Fi settings even when a flow fails.

The Android release verification workflow runs this suite on its Android emulator. For a physical-device spot check, use an Android 16 device with Expo Go, connect the device to the development server, and follow this checklist:

## Device checklist

1. Start the route with Wi-Fi disabled and confirm `SESSION VERIFICATION PAUSED` plus the saved fixture token.
2. Restore Wi-Fi without touching Retry. Confirm the fixture says `Verified without tapping Retry`.
3. Disable Wi-Fi, reboot Android, and confirm airplane mode and Wi-Fi remain disabled after boot. Restore connectivity, open the route, and confirm it verifies without a Retry tap.
4. Disable Wi-Fi, reopen the route, press Home, restore Wi-Fi while it is backgrounded, then reopen Expo Go. Confirm it verifies without a Retry tap.
5. Open the `transient` scenario while online. Confirm the session token remains visible after the failed attempts, then tap Retry and confirm verification completes.
6. Restore the original Wi-Fi and airplane-mode settings when done.

If the Android device policy or test runner prevents ADB from toggling Wi-Fi, keep the device steps manual and record which reconnect/resume path was checked; do not treat a run without a confirmed Wi-Fi state change as passing.
