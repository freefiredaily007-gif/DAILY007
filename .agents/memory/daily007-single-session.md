---
name: Daily007 single-session policy
description: Cross-device replacement, rollout compatibility, and stale client refresh behavior.
---

A successful new Daily007 sign-in replaces all previously issued Daily007 sessions for that account, across browsers and devices. Google linking from an already authenticated Daily007 session preserves that session. Tokens issued before rollout remain valid only until that account's next sign-in.

**Why:** The user chose to sign out the old session; keeping pre-rollout sessions until the next sign-in avoids forcing every account to log in again just because the feature was deployed.

**How to apply:** Enforce version matching on protected API requests and clear the app's local session when the server rejects an outdated token. An idle client notices replacement on its next authenticated request, not through a push notification.

On 2026-10-04, the user confirmed that after closing and reopening the published Android app, the designated account remained signed in and Earn and Wallet loaded successfully.

On cold-start session verification, clear a saved Daily007 token only after a 401 or 403 response. Network failures and server errors are inconclusive: keep the session and let the player retry.

**Why:** A temporary API outage must not sign out an account whose token may still be valid, while rejected tokens still need to return to authentication.

**How to apply:** Keep transport and 5xx failures separate from authorization rejection in session restore and retry flows.

Client account-access refreshes must remain tied to the session identity active when the request began. Serialize persistent session changes and discard delayed reads or writes after logout or another sign-in changes that identity.

**Why:** Async local storage can finish an operation after the player's intent changes. Checking only before starting a write still allows a delayed write to leave an old account as the final saved session.

**How to apply:** Scope refresh success and authorization failures to the captured account and token. Keep session storage mutations ordered and guarded so sign-out or a newer sign-in wins over pending work.