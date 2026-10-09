# Cancellation-refund accessibility checks

The Maestro flows open a development-only route that renders the same transaction row used by Wallet. Its fixture includes a tournament name, cancellation reason, positive coin amount, date, and post-refund balance. It uses no network requests.

## Android

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-wallet-cancellation-refund
```

`EXPO_DEV_URL` is the `exp://` base URL shown by Expo CLI, without the `/--/wallet-cancellation-refund-test` path.

## iOS VoiceOver accessibility element

Run the iOS flow on macOS with an iPhone simulator or connected iPhone, Maestro, Expo Go, and access to the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:ios-wallet-cancellation-refund
```

The iOS flow checks the single native refund row's accessible label for the full summary and verifies the fixture confirms each detail appears once. Maestro checks the accessibility element and label; it does not listen to VoiceOver audio.
