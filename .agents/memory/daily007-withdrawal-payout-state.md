---
name: Daily007 withdrawal payout state
description: Preserve the separation between withdrawal approval and a completed manual transfer.
---

The existing withdrawal CHECK constraint allows only `not_paid` and `manual_payout_required` in `payout_status`. A completed payout is represented by `paid_at`; API responses derive the user-facing `paid` state from that timestamp.

**Why:** Writing `paid` into `payout_status` violates the existing database constraint and returns a 500. Approval must also remain separate from whether money was actually transferred.

**How to apply:** Keep approval as `status = approved` and do not mark the payout paid until an authorized admin confirms the manual transfer. Use `paid_at` for that confirmation and derive display state from it. Verify the live database constraint before changing payout-state fields.
