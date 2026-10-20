# Wrong-password login accessibility: native device check

Use a test account that can be signed into successfully after the wrong-password attempt. Keep account credentials on the device; do not put them in test files or chat.

## Setup

- Open Daily007 in a signed-out state.
- Enable TalkBack on Android or VoiceOver on iOS.
- Stay on the **LOGIN** tab.

## Check on each platform

1. Enter the test account's email and an intentionally incorrect password.
2. Activate **LOGIN**.
3. Confirm the visible message, **“Email or password is incorrect.”**, is spoken once and is understandable.
4. Confirm screen-reader focus stays on the **LOGIN** action; the announcement should not move focus to another control.
5. Navigate back to the password field, replace the incorrect password with the correct one, and activate **LOGIN** again.
6. Confirm the player signs in successfully.

Record the spoken wording, whether it repeated, and where focus remained separately for Android TalkBack and iOS VoiceOver.

## Google recovery on Android

Use a signed-out test account whose Daily007 identity is already linked to the Google account being used. Make one wrong-password attempt so login throttling does not interfere.

1. Enter the linked account's email and an intentionally incorrect password, then activate **LOGIN**.
2. Confirm **“Email or password is incorrect.”** appears.
3. Confirm **Continue with Google** is enabled again.
4. Tap **Continue with Google** and finish the Google sign-in for that linked identity.
5. Confirm Daily007 signs in once and opens the app; the Google action should not remain busy or reopen the provider flow by itself.

## Platform behavior

- Android uses the Auth error's assertive live region.
- iOS uses one explicit `AccessibilityInfo.announceForAccessibility` call when the error changes; it does not rely on React Native live-region announcements.
- Web checks can verify the visible error, live-region label, and focus state, but cannot confirm native speech.
