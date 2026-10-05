---
name: Daily007 paired Home refresh lock
description: Prevent overlapping Home polling requests when a paired tournament or registration request fails early.
---

When a Home refresh depends on both tournament data and the player's registrations, keep the refresh marked in-flight until both requests settle. `Promise.all` can reject as soon as one request fails while the other is still pending, releasing the poll guard too early; wait for both outcomes before handling failure.

**Why:** A fast tournament failure paired with a delayed registration response allowed a later poll to overlap the still-running request.

**How to apply:** For paired Home refreshes, wait for all member requests to complete before clearing the in-flight guard, and preserve the current cards if either response fails.
