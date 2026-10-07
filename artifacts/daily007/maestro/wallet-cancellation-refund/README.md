# Android cancellation-refund accessibility check

The Maestro flow opens a development-only route that renders the same transaction row used by Wallet. Its fixture includes a tournament name, cancellation reason, positive coin amount, date, and post-refund balance. It uses no network requests.

Run it with an Android device or emulator that has Expo Go installed and can reach the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-wallet-cancellation-refund
```

`EXPO_DEV_URL` is the `exp://` base URL shown by Expo CLI, without the `/--/wallet-cancellation-refund-test` path.
