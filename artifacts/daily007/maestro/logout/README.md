# Android Clerk logout checks

The development-only `/logout-native-test` route mounts the real Daily007 app with a seeded authenticated admin and a controlled Clerk sign-out promise. The Android flows hold that promise open, confirm the signed-in screen is replaced by the signing-out screen, try logout again, and verify Clerk was called once. They then finish Clerk sign-out successfully or reject it and confirm the Daily007 login form appears in both cases.

The runner saves the current Daily007 session before the first flow and restores it after both flows, including when a flow fails. Run it with Expo Go connected to the development server and exactly one authorized Android device or emulator:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-logout
```

For a failed Clerk sign-out, dismiss the expected “Sign-out issue” alert before checking the login screen. If automatic cleanup fails, open `/logout-native-test?scenario=cleanup` in Expo Go while online.
