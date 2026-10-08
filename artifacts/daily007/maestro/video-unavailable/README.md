# Android unavailable-video accessibility check

This development-only fixture uses the same unavailable-error announcement and Back to videos button as the player. It starts the error after the screen mounts so Android receives a live-region text change. Maestro checks the native accessibility tree, the zero progress value, absence of a coin-claim retry, and that returning to the catalog triggers its refresh condition.

Run it with an Android device or emulator that has Expo Go installed and can reach the Expo development server:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-video-unavailable
```

Maestro can inspect accessibility nodes but cannot confirm TalkBack speech. For spoken-output verification on the iQOO Neo 10 running Android 16:

1. Turn on TalkBack, then open the `video-unavailable-test` route in Expo Go.
2. Listen for one polite announcement: “This video is unavailable.”
3. Confirm progress remains at 0% and no “Retry the coin reward claim” action is present.
4. Swipe to “Back to videos,” double-tap it, and confirm the refreshed catalog message appears.

The automated flow was not run in this workspace because no Android device or emulator is connected, and the Maestro CLI is unavailable here.
