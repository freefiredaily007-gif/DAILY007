# Tournament detail large-text check

These development-only Android flows open the real tournament detail screen with local solo and four-player squad fixtures. They check detail statistics, match information, the solo join route, the open team-slot join form, captain add-teammate controls, registered Hindi/Gujarati player names, translated registration status, released room credentials and copy feedback, and the four-slot team layout.

Connect exactly one authorized Android device or emulator with Expo Go installed, start the Daily007 Expo development server, and set `EXPO_DEV_URL` to its `exp://` URL without a route path. Then run:

```sh
pnpm --filter @workspace/daily007 run test:android-tournament-detail-large-text
```

The runner requires an Android phone or emulator whose display width is at most 400 dp, checks English, Hindi, and Gujarati at both 1.5× and 2× Android system text, restarts Expo Go between runs, and restores the original font scale even if Maestro fails. The captain flow checks both teammate identity fields and the cancel/pay actions, then exercises cancel and pay against a local response. The fixture does not contact the API or write tournament, registration, or wallet data.
