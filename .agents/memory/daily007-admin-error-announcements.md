---
name: Daily007 Admin error announcements
description: Accessibility rules for Admin failure messages and retry controls.
---

For Admin error announcements, give each toast a new accessibility node when it appears, even when its text matches the previous toast. Include the failed action, affected user/request, server error, and a safe next step. Name retry controls with the affected user or request.

For Admin success messages that auto-dismiss, cancel any earlier dismissal timer before showing a replacement. A delayed timer from one action must not clear a newer status announcement.

**Why:** Consecutive identical live-region text may not be announced as a new update, a generic error does not identify the affected action, and an earlier toast timer can silently erase a newer payment-status message.

**How to apply:** Preserve fresh-node behavior and contextual error/retry wording when changing Admin toast handling. Cancel or supersede stale timers when replacing success messages; confirm actual TalkBack speech on Android because source checks cannot establish native speech behavior.
