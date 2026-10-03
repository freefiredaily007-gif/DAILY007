---
name: Daily007 database CHECK constraints
description: Verify development database CHECK constraints after schema changes.
---

**Rule:** Verify actual CHECK constraint definitions in each relevant database environment; matching source and development schema do not prove production matches. Treat a schema-diff helper's `hasDiff: false` as inconclusive when an exact production definition shows drift.

**Why:** A stale production match-status constraint rejected `cancelled` and rolled back cancellation/refund transactions even though source and development already allowed it. The schema-diff helper did not report the expression mismatch.

**How to apply:** Compare `pg_get_constraintdef` in development and production. Correct development drift directly when needed; use Replit Publish for managed production schema changes, preserve production data, and verify the constraint afterward rather than assuming the diff summary included it.