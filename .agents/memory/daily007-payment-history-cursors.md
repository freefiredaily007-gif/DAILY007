---
name: Daily007 payment-history cursors
description: Cursor pagination decisions for player payment history.
---

Use keyset pagination scoped by the authenticated player, ordered newest-first by timestamp plus a unique ID tie-breaker. Keep each returned page capped at 200 rows.

**Why:** Offset pages can shift when new requests arrive, and JavaScript `Date` drops PostgreSQL sub-millisecond timestamp precision. Either can skip or repeat records when a player advances through history.

**How to apply:** Build the cursor from the exact database timestamp text and ID, then compare both columns in the next query. Keep the authenticated account ID as the query's user filter; a cursor is not an authorization boundary.
