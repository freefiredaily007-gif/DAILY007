---
name: Daily007 single-session policy
description: Cross-device session replacement and rollout compatibility decision.
---

A successful new Daily007 sign-in replaces all previously issued Daily007 sessions for that account, across browsers and devices. Google linking from an already authenticated Daily007 session preserves that session. Tokens issued before rollout remain valid only until that account's next sign-in.

**Why:** The user chose to sign out the old session; keeping pre-rollout sessions until the next sign-in avoids forcing every account to log in again just because the feature was deployed.

**How to apply:** Enforce version matching on protected API requests and clear the app's local session when the server rejects an outdated token. An idle client notices replacement on its next authenticated request, not through a push notification.

On 2026-10-04, the user confirmed that after closing and reopening the published Android app, the designated account remained signed in and Earn and Wallet loaded successfully.