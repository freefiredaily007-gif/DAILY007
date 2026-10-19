---
name: Daily007 video catalog concurrency
description: How manual catalog retries prevent older requests from replacing newer UI state.
---

**Rule:** Manual catalog retries must use React Query's `cancelRefetch: true`, and each callback must check a monotonically increasing request sequence before changing announcement state. A synchronous ref must also prevent a second manual retry while one is pending.

**Why:** Query cancellation prevents superseded network responses from committing to the cache; an older callback could otherwise announce its success or error after a newer retry.

**How to apply:** Keep cancellation and the request-sequence guard paired when changing Daily007 catalog reloads. Test by holding an older response, resolving a newer success first, then releasing stale data and checking that no inactive video, obsolete error, or duplicate announcement returns. On React Native Web, setting `disabled` on a focused `Pressable` drops focus even with `tabIndex={0}`; retain focus with the synchronous callback guard and communicate pending state through the changing accessibility label and busy state instead.
