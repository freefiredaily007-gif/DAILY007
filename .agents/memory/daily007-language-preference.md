---
name: Daily007 language preference storage
description: Scope for language preference persistence when API and database changes are not approved.
---

Keep the selected UI language in local storage keyed by the Daily007 player identity unless the user explicitly approves server-side profile synchronization.

**Why:** The requested language change required per-player isolation and restoration while prohibiting API, authentication, and database changes.

**How to apply:** Reset to English for guests and on account changes, then load the active player's local preference. Add cross-device synchronization only if the scope changes.
