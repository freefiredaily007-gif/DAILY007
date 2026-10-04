---
name: Daily007 leaderboard periods
description: Match-date attribution and Full Admin-approved weekly/monthly top-three rewards.
---

Leaderboard awards belong to the IST week or month containing the tournament's scheduled start time, not the later time when an administrator publishes results. Full Admins configure weekly and monthly top-three rewards before a cycle ends. At expiry, the scheduler snapshots standings and the cycle's reward configuration as `pending_approval`, then activates the next cycle without crediting wallets. Only a Full Admin can approve an ended cycle; approval pays positive configured rewards for ranks 1–3, records approver/time and resulting wallet balances, and finalizes atomically. Tournament Admins cannot access this flow.

**Why:** Tournament results can be published after the match, so award creation time can put an earlier match into a later cycle. Payouts also require an explicit Full Admin review; an automatic settlement would bypass that approval gate and risk unreviewed wallet credits.

**How to apply:** Attribute result awards through the match's `starts_at`. Persist reward defaults for future cycles and copy them into open periods; edits to an open period apply before its end. At expiry, snapshot standings and rewards but do not modify wallets. Keep pending approvals available while the next cycle runs. On Full Admin approval, use stable ledger idempotency keys and one transaction for all wallet updates, balance-after ledger entries, approver metadata, and finalization; repeated approval must never pay twice.