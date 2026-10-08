---
name: Daily007 Player pull-to-refresh
description: Native Android confirmation that failed refreshes preserve the last good tournament card and successful retries update it.
---

On 2026-10-08, the Player's native Android pull-to-refresh was confirmed to preserve the last successfully loaded tournament card and show an error after a failed request. A later successful pull updated the card and cleared the error.

On 2026-10-08, TalkBack was also confirmed to announce the refresh error while the existing tournament remained visible; after a successful retry, updated data appeared and the stale error cleared.

**Why:** React Native Web does not implement native pull gestures or verify TalkBack speech; its test-only control exercises the same refresh callback but cannot confirm native gesture and announcement behavior.

**How to apply:** Preserve both failure and recovery states in future Player refresh changes. Use browser regressions for callback/data behavior and a native Android pull with TalkBack enabled to verify gesture and announcement behavior.
