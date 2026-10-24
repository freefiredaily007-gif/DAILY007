# Kill & Earn admin create/edit Android flow

This Maestro flow runs the real `AdminTournaments`, `HomeGameModeCards`,
`ModeSubmodes`, and `Tournaments` screens in a development-only route. It
creates and edits local Solo, Duo, and Squad Kill & Earn fixtures, then checks
the matching player list and live format count after every save.

All tournament reads and writes in this route use in-memory fixtures. The
generated API fetch path is replaced with a local-only handler; any unrecognized
request is blocked and displayed in the test header. `Api.createTournament`,
`Api.updateTournament`, `Api.tournaments`, and `Api.myRegistrations` are
restored when the route unmounts. No production tournament, registration,
account, or wallet data is read or changed.

Start the Daily007 Expo development workflow, connect one authorized Android
device or emulator with Expo Go, then run:

```sh
EXPO_DEV_URL=https://your-expo-development-url pnpm --filter @workspace/daily007 run test:android-kill-earn-admin-flow
```

The `EXPO_DEV_URL` value must point to the running Expo development server.
