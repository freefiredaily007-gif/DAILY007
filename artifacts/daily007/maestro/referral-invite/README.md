# Android referral invite recovery check

This Maestro flow opens the signed-in app's Earn tab, forces the referral-code clipboard write to reject using a development-only switch, and checks that the Android share sheet opens with the referral code and HTTPS invite URL. It closes the chooser and verifies the fallback message and Earn actions remain available.

Before running, sign in to Daily007 in Expo Go on one Android device or emulator and make sure that account has a referral dashboard. Then run:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-referral-invite
```

Use an English-language Android device so Maestro can identify the native “Sharing link” chooser heading. The test uses the real Earn screen, referral data, React Native Share API, and Android chooser; only the clipboard rejection is simulated. This development-only simulation is absent from production builds.
