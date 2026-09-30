---
name: Daily007 Google authentication bridge
description: Why Google SSO is additive to the original Daily007 account and wallet model.
---

Keep Daily007's own account ID, email/password option, and bearer token as the identity used for coins, tournaments, and admin permissions. Replit-managed Clerk is used only to prove a Google identity before the backend creates or links a Daily007 account.

**Why:** Replacing the account system just to add Google would risk disconnecting wallets and registrations. An equal email address is not sufficient to take over an existing account, even when Google verifies it; an email can be reassigned. Existing password accounts must explicitly connect Google while signed in.

**How to apply:** Never auto-link by email or trust an email sent by the app. Verify the provider session server-side, use a unique immutable provider subject, and require both valid sessions to connect an existing Daily007 account. Preserve both sign-in methods when changing auth UI.

The user reported that the Android flow completed, and a Google-linked account appeared in the development backend. This confirms the additive bridge can complete on Android; a future production build should still be checked against its own redirect and provider configuration.