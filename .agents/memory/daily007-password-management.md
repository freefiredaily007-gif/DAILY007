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

A retry after a missing password-change response may confirm that the requested new password is already active. Preserve the entered values and existing session, and still count the stale current-password check against the retry limit.

**Why:** The server can commit before the client loses its reply; a safe identical retry removes ambiguity without account recreation or a new sign-in.

**How to apply:** Explain transport failures as uncertain, keep the form open, and accept the identical retry only when its requested new password matches the stored credential.