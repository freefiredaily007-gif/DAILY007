---
name: Daily007 Admin error announcements
description: Accessibility rules for Admin failure messages and retry controls.
---

For Admin error announcements, give each toast a new accessibility node when it appears, even when its text matches the previous toast. Include the failed action, affected user/request, server error, and a safe next step. Name retry controls with the affected user or request.

**Why:** Consecutive identical live-region text may not be announced as a new update, and a generic error does not tell a screen-reader user which row or action to revisit.

**How to apply:** Preserve the fresh-node behavior and contextual error/retry wording when changing Admin toast handling or the registration, payment, wallet, and user-management screens. Confirm actual TalkBack speech on Android; source checks cannot establish native speech behavior.
