---
name: Daily007 query polling tests
description: How to test TanStack Query polling and remount behavior in Node.
---

For client polling tests, install minimal `window` and `document` globals before dynamically importing TanStack Query. QueryObserver detects Node server mode when `window` is absent and suppresses refetch-interval timers. Assert the production interval value, then use a shorter interval in the observer harness to exercise polling quickly; separately test remount and focus-triggered refetches.

**Why:** A plain Node query test can silently omit the client polling behavior this regression is meant to cover.

**How to apply:** Use the browser-like harness for client query lifecycle tests. Keep API route tests isolated in their in-memory database fixture.