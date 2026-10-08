---
name: Daily007 JoinForm accessibility
description: Registration field labels, native TalkBack order, and validation announcements.
---

For registration validation, show the message next to the affected input and set it as that input's accessibility hint. Keep the shared polite live region as the only immediate announcement, and do not move focus. Hide the adjacent visual copy from the accessibility tree so it is not a second stop.

**Why:** Players need one clear announcement and a way to rediscover the error from the field that needs correction, without losing their current focus.

**How to apply:** Preserve this split when changing captain, team, or teammate validation; do not add another live region or a separate programmatic announcement.

When retrying an error with identical text, change the live-region node identity for each raised error while keeping it a single polite region. React may batch clearing and resetting the same message into no text change.

**Why:** An unchanged message can be suppressed by the native accessibility update; forcing a fresh live-region node preserves one update for each failed attempt without changing the spoken text.

**How to apply:** Increment a key for the existing visible error message on each error; do not add a second announcement path, temporarily alter the text, or move focus.

## Native field announcements
On 2026-10-07, the user confirmed that TalkBack on an iQOO Neo 10 running Android 16 announced the registration fields correctly; no mismatch with the expected Squad field order was reported.

**Why:** Native announcement order cannot be proven by source assertions alone.

**How to apply:** Treat this as a user-confirmed native smoke check when changing registration field labels or order; distinguish it from automated source-level tests.

## Native registration error announcements
On 2026-10-08, the user confirmed that TalkBack on the iQOO Neo 10 / Android 16 announced both the local missing-name error and insufficient-wallet server error once without moving focus. A full-capacity rejection included the refreshed 12/12 count.

**Why:** Source-level live-region assertions cannot prove native speech timing, duplicate announcements, or focus behavior.

**How to apply:** When changing JoinForm error announcements or capacity recovery, preserve the single polite live region and no-focus-move behavior, and verify the actual Android speech for local validation, server rejection, and refreshed capacity.
