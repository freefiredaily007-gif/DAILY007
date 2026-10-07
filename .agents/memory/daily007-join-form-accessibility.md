---
name: Daily007 JoinForm accessibility
description: Registration field labels, native TalkBack order, and validation announcements.
---

For registration validation, show the message next to the affected input and set it as that input's accessibility hint. Keep the shared polite live region as the only immediate announcement, and do not move focus. Hide the adjacent visual copy from the accessibility tree so it is not a second stop.

**Why:** Players need one clear announcement and a way to rediscover the error from the field that needs correction, without losing their current focus.

**How to apply:** Preserve this split when changing captain, team, or teammate validation; do not add another live region or a separate programmatic announcement.

## Native field announcements
On 2026-10-07, the user confirmed that TalkBack on an iQOO Neo 10 running Android 16 announced the registration fields correctly; no mismatch with the expected Squad field order was reported.

**Why:** Native announcement order cannot be proven by source assertions alone.

**How to apply:** Treat this as a user-confirmed native smoke check when changing registration field labels or order; distinguish it from automated source-level tests.
