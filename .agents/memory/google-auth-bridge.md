---
name: Daily007 Google authentication bridge
description: Why Google SSO is additive to the original Daily007 account and wallet model.
---

Keep Daily007's own account ID, email/password option, and bearer token as the identity used for coins, tournaments, and admin permissions. Replit-managed Clerk is used only to prove a Google identity before the backend creates or links a Daily007 account.

**Why:** Replacing the account system just to add Google would risk disconnecting wallets and registrations. An equal email address is not sufficient to take over an existing account, even when Google verifies it; an email can be reassigned.

**How to apply:** Never auto-link by email or trust an email sent by the app. Verify the provider session server-side, use a unique immutable provider subject, and require both valid sessions for ordinary account linking. The separate recovery exception requires a different Full Admin, an audit note, and fresh verification of the Google subject and email; it binds Google to the same local account without replacing its password, wallet, or tournament history. Tournament Admins cannot view or approve recovery requests.

A pending Google recovery request cannot link an account that has become blocked since submission; approval requires the account to still be active.

**Why:** Pending requests can outlive an account block, and allowing one to complete would reconnect an account whose access was withdrawn.

**How to apply:** Re-check the target's current status during approval and leave both the Google link and review fields unchanged when the account is blocked.

As of 2026-10-03, the production Daily007 account has one Full Admin. That administrator's own recovery request cannot be approved under the two-person rule until a second reviewer or a separate owner-controlled recovery method exists.

**Why:** The requester confirmed there is no second Full Admin, so allowing the existing self-review path would leave their request permanently pending.

**How to apply:** Keep ordinary recovery under a different Full Admin's review. For the sole Full Admin, allow recovery only with a separate high-entropy owner code plus a freshly verified Google identity; restrict that route to the sole active Full Admin, record its method in the audit row, and never persist or log the code.

On 2026-10-04, the user reported a real Android Profile → Connect Google run with a Development password account: the same Daily007 account and wallet remained active, and Wallet loaded afterward. This confirms the additive link preserved the current session for authenticated reads; a future production build should still be checked against its own redirect and provider configuration.

On 2026-10-05, the user confirmed a real Android Google signup opened Wallet with 10 coins and one welcome-bonus entry.

**Why:** Mocked server tests cannot prove the native OAuth handoff and subsequent Wallet history load work together on a phone.

**How to apply:** Preserve the verified Clerk-session activation, Daily007 session setup, and Wallet refresh sequence. Recheck signup-to-Wallet behavior on Android after changing the SSO callback, session handling, or signup reward display.

On 2026-10-05, the user also confirmed both flows on a standalone Android Play build: a fresh Google signup returned to Daily007 with 10 coins and one welcome-bonus row, and linking Google to an existing password account preserved its account, wallet balance, and session. The installed version was not identified; the repository was configured for app version 1.0.1 and Android versionCode 2.

**Why:** Expo Go and mocked browser checks do not prove the standalone Android callback, provider setup, and account-link behavior work together.

**How to apply:** Treat the reported Play-build flows as the device baseline, but do not assume the tested binary matched the repository version unless its installed versionCode is confirmed.

On 2026-10-17, the user reported that the native Android check for a pending Google attempt passed: LOGIN/SIGN UP and password submission stayed blocked, no password authentication started, and one Daily007 session remained after completion.

**Why:** Browser automation cannot confirm real Android touch behavior during the Google handoff.

**How to apply:** Treat this pending-attempt sequence as device-confirmed; recheck it after changing the Auth controls, Google busy-state wiring, or native SSO callback.

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

When the server accepts a Google link but the returned Daily007 session cannot be saved locally, retain the active password session and its stored token; report the device-storage failure without clearing or replacing that session.

**Why:** The provider link can commit remotely before AsyncStorage rejects the client-side write, so treating the persistence error as an expired account session can strand an otherwise usable player.

**How to apply:** Keep session-persistence failures distinct from API authorization failures and continue protected calls with the original password-account bearer token.

On 2026-10-14, the user reported that after a native Android force-close and relaunch, a linked password account still showed Google connected, an unlinked account still offered Connect Google, and the account ID, wallet balance, and Daily007 token were unchanged.

**Why:** Browser mocks cannot prove native AsyncStorage survives an Android process restart.

**How to apply:** Treat these restart checks as physically confirmed; repeat them after changing Google-link status refresh or Daily007 session restoration.

## Google sign-in error accessibility

On Android, keep Google failure speech on one path: the Google button announces once after loading clears, and the login screen displays that error without a second assertive live-region announcement. Keep ordinary email/password failures on their existing live region.

**Why:** Combining `AccessibilityInfo.announceForAccessibility` with an assertive parent error live region can speak the same Google failure twice. On 2026-10-09, the user confirmed on Android 16 with TalkBack that provider and Daily007 server failures were each spoken once and the Google button remained retryable after the duplicate path was removed.

**How to apply:** When changing the Google sign-in error callback, preserve one Android announcement, visible error text, and a retry-enabled button after loading ends. Confirm platform-specific announcements on a real device; source tests alone do not establish TalkBack speech.

On 2026-10-09, the user confirmed on Android TalkBack that missing-session, simulated recovery-request, and simulated owner-code errors each spoke once and left the relevant recovery action retryable.

**Why:** The recovery actions use distinct controls from ordinary Google sign-in, and the development-only local simulation verified their announcement and retry paths without contacting recovery APIs or requiring the owner code.

**How to apply:** Keep recovery simulations development-only and local. After changing recovery error handling, recheck all three paths with TalkBack; do not treat source assertions or browser behavior as proof of native speech.