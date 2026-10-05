# Android tournament join rejection tests

These Maestro flows open the development-only `/join-recovery-test` route. The route uses local fixture data and simulated API errors; it does not send requests, charge coins, or write registrations.

Run with an Android device or emulator that has Expo Go installed and can reach the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-join-recovery
```

`EXPO_DEV_URL` is the `exp://` base URL shown by Expo CLI, without the `/--/join-recovery-test` path. These tests are separate from the browser-based Node regression test.
