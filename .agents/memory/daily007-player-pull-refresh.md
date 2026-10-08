---
name: Daily007 Player pull-to-refresh
description: Native Android confirmation that failed refreshes preserve the last good tournament card and successful retries update it.
---

On 2026-10-08, the Player's native Android pull-to-refresh was confirmed to preserve the last successfully loaded tournament card and show an error after a failed request. A later successful pull updated the card and cleared the error.

**Why:** React Native Web does not implement native pull gestures; its test-only control exercises the same refresh callback but cannot verify the Android `RefreshControl` gesture.

**How to apply:** Preserve both failure and recovery states in future Player refresh changes. Use the browser regression for callback/data behavior and a native Android pull to verify the gesture integration.
