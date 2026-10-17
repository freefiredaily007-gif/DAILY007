# Password signup session-save retry accessibility check

This development-only test route simulates two consecutive local session-save failures after signup. It does not call the API, create an account, or write a session to device storage.

## Native accessibility-tree check

With one Android device or emulator connected, Expo Go installed, Maestro available, and `EXPO_DEV_URL` set to the Expo development URL, run:

```sh
pnpm --filter @workspace/daily007 exec maestro test maestro/signup-session-retry-accessibility/repeated-session-save-failure.yaml
```

The flow confirms that the session-save error and retry action remain visible after both failures. Maestro checks the native accessibility tree; it does not record TalkBack speech.

## TalkBack check on Android

1. Enable TalkBack and open `EXPO_DEV_URL/--/signup-session-retry-accessibility-test` in Expo Go.
2. Swipe to **SIGN UP**, then enter any name, email, and password in the test form.
3. Activate **Create Account**. Confirm TalkBack announces: “Daily007 could not save your session on this device. Check available storage and try again.”
4. Confirm focus stays on the submit action. Swipe to it if needed and verify it is announced as **Retry saving session**.
5. Activate the retry without changing the form. Confirm the same error is announced again, without an unexpected focus jump, and that **Retry saving session** remains reachable.

The fixture uses the real `Auth` screen and its Android announcement behavior, while the simulated persistence errors avoid creating test accounts.
