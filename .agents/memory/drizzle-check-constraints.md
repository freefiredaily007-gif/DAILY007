---
name: Drizzle check-constraint drift
description: Verify PostgreSQL CHECK constraints after changing their Drizzle definitions
---

Changing an existing PostgreSQL CHECK definition in Drizzle may not alter the live development constraint even when `drizzle-kit push` reports success. Query `pg_constraint` for the live definition after editing CHECK rules, especially financial statuses and configured limits.

**Why:** A wallet payout was rejected by a stale database constraint after the schema source already allowed `paid`. A minimum-coins constraint also retained an older threshold despite a successful push.

**How to apply:** After changing CHECK definitions, compare the live development rules with schema source. Correct development drift using the database workflow; never run ad hoc production DDL. Production schema changes follow the managed Publish diff.