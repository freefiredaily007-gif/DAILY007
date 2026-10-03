---
name: Daily007 database CHECK constraints
description: Verify development database CHECK constraints after schema changes.
---

**Rule:** Verify actual CHECK constraint definitions in each relevant database environment; matching source and development schema do not prove production matches. If same-name CHECK expressions differ but the schema-diff helper reports no change, rename the source constraints, push the schema to development, then verify that Publish exposes the replacement.

**Why:** A stale production match-status constraint rejected `cancelled` and rolled back cancellation/refund transactions even though source and development already allowed it. The schema-diff helper did not report the expression mismatch.

**How to apply:** Compare `pg_get_constraintdef` in development and production. When needed, rename the source constraints and push to development so Publish detects old-constraint removal and new-constraint creation. Verify existing production rows satisfy the new checks, preserve production data, use Replit Publish rather than direct production DDL, and verify the final definitions afterward.