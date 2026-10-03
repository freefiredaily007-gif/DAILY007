---
name: Daily007 password management
description: Scope and verification rules for changing a Daily007 password from Profile.
---

Profile password changes apply to the Daily007 account, not the user's Google credentials. The selected flow requires the current password; forgotten-password email recovery is not part of this choice.

**Why:** The user chose a signed-in password change with current-password verification rather than email recovery.

**How to apply:** Keep current-password verification on the server, follow the existing signup password-length rules, and make clear that Google credentials are managed separately.