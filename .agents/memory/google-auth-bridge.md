---
name: Daily007 Google authentication bridge
description: Why Google SSO is additive to the original Daily007 account and wallet model.
---

Keep Daily007's own account ID, email/password option, and bearer token as the identity used for coins, tournaments, and admin permissions. Replit-managed Clerk is used only to prove a Google identity before the backend creates or links a Daily007 account.

**Why:** Replacing the account system just to add Google would risk disconnecting wallets and registrations. An equal email address is not sufficient to take over an existing account, even when Google verifies it; an email can be reassigned. Existing password accounts must explicitly connect Google while signed in.

**How to apply:** Never auto-link by email or trust an email sent by the app. Verify the provider session server-side, use a unique immutable provider subject, and require both valid sessions to connect an existing Daily007 account. Preserve both sign-in methods when changing auth UI.

The user reported that the Android flow completed, and a Google-linked account appeared in the development backend. This confirms the additive bridge can complete on Android; a future production build should still be checked against its own redirect and provider configuration.

For Expo Google SSO, treat the returned session ID and the active Clerk session as separate states: await the `setActive` function returned by `startSSOFlow` before reading the Clerk session or requesting its token, then verify that the active session ID matches.

**Why:** `startSSOFlow` can return a completed session without making it the active session automatically. Reading the active session first can produce an intermittent missing or stale session.

**How to apply:** In native Expo SSO flows, activate the returned session before exchanging its token with the Daily007 backend; do not infer activation from the OAuth callback alone.

Expo Go's StoreClient environment ignores app-defined redirect schemes that it does not support and falls back to `exp://`, while retaining the development host and callback path. The `sso-callback` path is also used by the web popup return flow, so avoid removing it globally.

**Why:** Expo Go and standalone builds resolve deep links differently. A global redirect change can break web or installed-app callbacks without fixing an Expo Go runtime error.

**How to apply:** When Google SSO fails in Expo Go, capture the generated redirect or the phone's error log before changing callback paths. Keep web and standalone redirect behavior intact unless the exact failure points to them.