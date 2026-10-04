---
name: Daily007 database CHECK constraints
description: Verify development database CHECK constraints after schema changes.
---

**Rule:** Verify actual CHECK constraint definitions in each relevant database environment; matching source and development schema do not prove the live database matches. Schema pushes can report success while an existing CHECK expression remains stale. If same-name expressions differ but the schema-diff helper reports no change, rename the source constraint, push the schema to development, then verify that Publish exposes the replacement.

**Why:** A stale production match-status constraint rejected `cancelled` and rolled back cancellation/refund transactions. A separate wallet change also found development status and minimum-value checks unchanged after a successful push.

**How to apply:** Compare `pg_get_constraintdef` in development and production after changing CHECK rules. For development drift, repair only after verifying existing rows satisfy the intended rule. For production, rename the source constraint and use Replit Publish rather than direct DDL; verify final definitions afterward.