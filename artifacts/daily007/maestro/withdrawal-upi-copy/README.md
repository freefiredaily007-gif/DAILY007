# Android withdrawal UPI clipboard check

This development-only Maestro flow opens the real AdminPayments screen with a local, non-sensitive test withdrawal. The fixture account is redacted in the rendered list and masked in a secure neutral field. The flow copies it, pastes it, and checks exact equality without writing the value to test logs or screenshots. It does not call payment or payout APIs.

Run with one Android device or emulator connected, Expo Go installed, Maestro available, and `EXPO_DEV_URL` set:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-withdrawal-upi-copy
```

The clipboard and native Android paste menu are real. Only the withdrawal data is local fixture data; no payment or payout operation is invoked.
