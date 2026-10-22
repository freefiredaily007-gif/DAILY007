---
name: Daily007 tournament retention
description: Current rule for tournament lifecycle and deletion.
---

**Rule:** Do not automatically delete tournaments or their match records. Keep started tournaments available as Ongoing until an admin publishes results, manually cancels and refunds, or deletes the tournament. Manual deletion must preserve user accounts, wallet balances, wallet transactions, and player history.

**Why:** The user requested indefinite tournament availability unless an admin takes an explicit action.

**How to apply:** Do not start time-based tournament cleanup in the API process. Keep manual admin cancellation, refund, and delete actions separate from background jobs.
