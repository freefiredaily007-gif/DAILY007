# Android form background/resume check

This development-only Maestro flow mounts the real Edit Profile and tournament Join forms with local fixture data. For each form, it enters values, sends Expo Go to the background with Android Home, returns to the app, and uses Save or Join. The result labels show the exact values received by each action handler. No account, tournament, or server data is changed.

Run with one authorized Android device or emulator, Expo Go, Maestro, and the Daily007 development server available:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-form-resume
```

The route is development-only and redirects to the app root in production builds.
