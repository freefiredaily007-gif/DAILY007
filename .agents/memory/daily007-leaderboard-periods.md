---
name: Daily007 leaderboard periods
description: Match-date attribution and automatic weekly/monthly top-three rewards.
---

Leaderboard awards belong to the IST week or month containing the tournament's scheduled start time, not the later time when an administrator publishes results. Full Admins configure weekly and monthly top-three rewards before a cycle ends. The scheduler snapshots standings, credits configured winners, records wallet history, and finalizes the period atomically; there is no end-of-cycle approval gate.

**Why:** Tournament results can be published after the match, so award creation time can put an earlier match into a later cycle. Configuring rewards before the deadline makes settlement predictable, while the atomic finalization keeps standings and wallet credits together.

**How to apply:** Attribute result awards through the match's `starts_at`. Persist reward defaults for future cycles and copy them into open periods; edits to an open period apply before its end. At expiry, pay only ranks 1–3 with positive configured amounts, using stable ledger idempotency keys and the same transaction as the final standings snapshot.