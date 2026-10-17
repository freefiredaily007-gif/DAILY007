# Google sign-up announcements: native device check

This checklist verifies spoken announcements and screen-reader focus on the real React Native app. The browser test checks button state and focus but cannot capture TalkBack or VoiceOver speech.

## Setup

- Use a Daily007 development build with Google sign-in configured and a test backend.
- Enable TalkBack on Android or VoiceOver on iOS.
- Open the app signed out and select **SIGN UP**.
- Use a test Google identity. For the failure case, use a referral code verified as invalid in the test backend so signup is rejected without creating an account.

## Check on each platform

1. Swipe to **Sign up with Google**. Confirm it is announced as a button.
2. Activate it and do not move screen-reader focus. While Google is pending, confirm the action remains focused and unavailable, and hear **“Connecting to Google. Please wait.”** once.
3. Complete Google signup with a new test identity. Confirm **“Google sign-up complete.”** is announced once.
4. Return to a fresh signed-out test state. Enter the verified-invalid referral code and activate **Sign up with Google** again.
5. After the provider returns and Daily007 rejects the signup, confirm the error is announced once, focus remains on the Google action, and the action can be retried.

## Platform notes

- Android and iOS use explicit native accessibility announcements for progress, completion, and failure. The visible error remains available on the Auth screen.
- The web preview keeps its assertive live-region behavior. React Native live regions are not used as the iOS speech mechanism.
- Maestro can inspect native accessibility elements but does not confirm spoken audio. Record the screen reader’s actual wording, whether any message repeats, and whether focus moves on Android TalkBack and iOS VoiceOver separately.
