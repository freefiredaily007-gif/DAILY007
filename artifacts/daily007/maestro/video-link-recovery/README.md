# Android video-link recovery accessibility check

This development-only route renders the same recovery component used by the Video screen. The fixture simulates the initial YouTube-and-browser failure, a browser retry failure, and successful or failed clipboard copying. It shows the selected video and catalog search so they can be checked after returning to Daily007.

Run the automated accessibility-tree checks with one Android device or emulator connected, Expo Go installed, Maestro available, and `EXPO_DEV_URL` set to the Expo development URL:

```sh
EXPO_DEV_URL=exp://YOUR_EXPO_HOST:PORT pnpm --filter @workspace/daily007 run test:android-video-link-recovery
```

The flow checks that the recovery announcement, browser retry, copy action, copy result, and manual URL are present in the native accessibility tree. It does not synthesize or verify spoken TalkBack output.

For physical TalkBack verification on the iQOO Neo 10 running Android 16:

1. Open `/--/video-link-recovery-test?copy=fail` in Expo Go with TalkBack enabled.
2. Confirm the failure announcement says neither YouTube nor the browser opened the video.
3. Swipe through the controls. Confirm “Retry opening the video in your browser” comes before “Copy video link,” and both actions are reachable.
4. Activate browser retry, then copy. Confirm TalkBack announces the browser retry failure, the automatic copy failure, and the selectable URL. Long-press or use TalkBack text-selection actions to copy the URL manually.
5. Reopen `/--/video-link-recovery-test?copy=success`, activate copy, and confirm the success message is spoken without a manual URL.
6. Switch away from Expo Go and return. Confirm the selected-video and catalog-search text remain unchanged.
