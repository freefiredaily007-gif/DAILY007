# Android rejected-deposit accessibility test

The Maestro flow opens a development-only route that renders the same rejected-payment row used by Wallet. It uses fixture data only and makes no network requests.

Run it with an Android device or emulator that has Expo Go installed and can reach the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-wallet-rejected-deposit
```

The runner temporarily sets the Android system font scale to 1.5 and restores the previous scale when Maestro exits. `EXPO_DEV_URL` is the `exp://` base URL shown by Expo CLI, without the `/--/wallet-rejected-deposit-test` path.
