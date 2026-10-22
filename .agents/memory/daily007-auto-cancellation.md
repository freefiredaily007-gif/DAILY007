---
name: Daily007 manual tournament cancellation
description: Current policy for cancellation and entry-fee refunds.
---

**Rule:** Tournament cancellation and entry-fee refunds are manual admin actions only. Keep the authorized “Cancel & Refund” flow, including its transactional wallet ledger updates and duplicate-refund protections. Do not run time-based or underfilled-match cancellation/refund sweeps.

**Why:** The user requested that tournaments never be automatically cancelled or refunded.

**How to apply:** Keep the manual admin endpoint intact, but do not start or schedule the automatic cancellation job from the API process. A match reaching its start time is not a cancellation trigger.