---
name: Daily007 Google authentication bridge
description: Why Google SSO is additive to the original Daily007 account and wallet model.
---

Keep Daily007's own account ID, email/password option, and bearer token as the identity used for coins, tournaments, and admin permissions. Replit-managed Clerk is used only to prove a Google identity before the backend creates or links a Daily007 account.

**Why:** Replacing the account system just to add Google would risk disconnecting wallets and registrations. An equal email address is not sufficient to take over an existing account, even when Google verifies it; an email can be reassigned.

**How to apply:** Never auto-link by email or trust an email sent by the app. Verify the provider session server-side, use a unique immutable provider subject, and require both valid sessions for ordinary account linking. The separate recovery exception requires a different Full Admin, an audit note, and fresh verification of the Google subject and email; it binds Google to the same local account without replacing its password, wallet, or tournament history. Tournament Admins cannot view or approve recovery requests.

As of 2026-10-03, the production Daily007 account has one Full Admin. That administrator's own recovery request cannot be approved under the two-person rule until a second reviewer or a separate owner-controlled recovery method exists.

**Why:** The requester confirmed there is no second Full Admin, so allowing the existing self-review path would leave their request permanently pending.

**How to apply:** Keep ordinary recovery under a different Full Admin's review. For the sole Full Admin, allow recovery only with a separate high-entropy owner code plus a freshly verified Google identity; restrict that route to the sole active Full Admin, record its method in the audit row, and never persist or log the code.

On 2026-10-04, the user reported a real Android Profile → Connect Google run with a Development password account: the same Daily007 account and wallet remained active, and Wallet loaded afterward. This confirms the additive link preserved the current session for authenticated reads; a future production build should still be checked against its own redirect and provider configuration.

For Expo Google SSO, treat the returned session ID and the active Clerk session as separate states: await the `setActive` function returned by `startSSOFlow` before reading the Clerk session or requesting its token, then verify that the active session ID matches.

**Why:** `startSSOFlow` can return a completed session without making it the active session automatically. Reading the active session first can produce an intermittent missing or stale session.

**How to apply:** In native Expo SSO flows, activate the returned session before exchanging its token with the Daily007 backend; do not infer activation from the OAuth callback alone.

After a Daily007 account reset, the phone can still have a signed-in Clerk session because Clerk's token cache is separate from Daily007's local session and database. When the user explicitly chooses Google sign-in, reuse that active Clerk session and pass its token through the backend's Google-identity verification instead of starting a second OAuth flow.

**Why:** Starting another OAuth flow while Clerk is already signed in can fail with an “already signed in” message, even though the existing Google identity is usable to recreate the local Daily007 account.

**How to apply:** When local Daily007 auth is missing but Clerk has an active mobile session, exchange that session through the Google bridge. Keep server-side provider and verified-email checks, and do not auto-link an existing password account by matching email.

Expo Go's StoreClient environment ignores app-defined redirect schemes that it does not support and falls back to `exp://`, while retaining the development host and callback path. The `sso-callback` path is also used by the web popup return flow, so avoid removing it globally.

**Why:** Expo Go and standalone builds resolve deep links differently. A global redirect change can break web or installed-app callbacks without fixing an Expo Go runtime error.

**How to apply:** When Google SSO fails in Expo Go, capture the generated redirect or the phone's error log before changing callback paths. Keep web and standalone redirect behavior intact unless the exact failure points to them.

On 2026-10-03, the user asked to remove the Full Admin Recovery UI and the login-home admin-review/owner-code controls; they have the owner key. Keep server-side recovery and stored request records intact unless they separately request their removal.

**Why:** The user wants recovery controls out of the admin and login interfaces, while retaining backend recovery and its data.

**How to apply:** Keep the Recovery tab and login-home recovery controls out of the UI while preserving server-side owner-code recovery and audit records.

## Logout integrity

**Rule:** Logging out must clear the local Daily007 session even if Clerk sign-out fails.

**Why:** The user asked for automated coverage that keeps logout enforced; a provider sign-out problem must not leave the Daily007 wallet session active.

**How to apply:** Always clear the stored Daily007 token and app user state after attempting Clerk sign-out. Report a Clerk failure separately, and keep protected API access dependent on a valid Daily007 token.