# Tournament card large-text check

This development-only Android flow renders the shared tournament mode filters, browse cards, progress indicators, and room-credential panel using fixed local fixture data. It checks All, BR Kill & Earn, BR Classic, Clash Squad, and Lone Wolf at both 1.5× and 2× system text. No account, tournament, or server data is changed.

Start the Daily007 Expo development server and connect exactly one authorized Android device or emulator with Expo Go installed. Set `EXPO_DEV_URL` to the Expo CLI `exp://` URL, without the route path, then run:

```sh
pnpm --filter @workspace/daily007 run test:android-tournament-large-text
```

The runner verifies each system font-scale change, restarts Expo Go at 1.5× and 2×, executes the same Maestro flow, and restores the original Android font scale even when a check fails. The flow verifies the long tournament title and date, all three card metrics, player progress, join action, mode selection and filter wrapping, the released room ID/password, and room-ID copy feedback.
