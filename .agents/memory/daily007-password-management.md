---
name: Daily007 password management
description: Scope and verification rules for changing a Daily007 password from Profile.
---

Profile password changes apply to the Daily007 account, not the user's Google credentials. The selected flow requires the current password; forgotten-password email recovery is not part of this choice.

**Why:** The user chose a signed-in password change with current-password verification rather than email recovery.

**How to apply:** Keep current-password verification on the server, follow the existing signup password-length rules, and make clear that Google credentials are managed separately.

On iQOO Neo 10 / Android 16, TalkBack was physically confirmed to speak a password-change 409 conflict once while keeping focus in the form; the current password could be corrected and the request retried.

On the same device, TalkBack was confirmed to speak successful password-change feedback once, close the form without an unexpected focus jump, and leave all three password fields cleared.

**Why:** The user confirmed both the conflict-recovery and success paths on Android, so future accessibility changes should preserve the verified behavior.

**How to apply:** Keep each outcome in one polite live region. Do not move focus programmatically; preserve the form on failure and close and clear it after success.

A password-change retry is exempt from failed-attempt accounting only when it repeats the same request ID and full submitted password payload as a successfully committed change; a keyed fingerprint is stored with that update. Distinct or altered requests still use the shared limiter.

**Why:** The app must recover if multiple success replies are lost, without turning replay recognition into a way to evade current-password throttling.

**How to apply:** Reuse the client operation ID only while retrying unchanged form values. Preserve the current session and keep all other incorrect-password checks subject to the existing limiter.