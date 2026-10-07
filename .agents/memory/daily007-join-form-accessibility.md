---
name: Daily007 JoinForm validation accessibility
description: Field-level registration errors and their single TalkBack announcement.
---

For registration validation, show the message next to the affected input and set it as that input's accessibility hint. Keep the shared polite live region as the only immediate announcement, and do not move focus. Hide the adjacent visual copy from the accessibility tree so it is not a second stop.

**Why:** Players need one clear announcement and a way to rediscover the error from the field that needs correction, without losing their current focus.

**How to apply:** Preserve this split when changing captain, team, or teammate validation; do not add another live region or a separate programmatic announcement.
