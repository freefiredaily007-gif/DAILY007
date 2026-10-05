---
name: API PostgreSQL concurrency tests
description: Lock-order observations for integration tests that exercise API requests against PostgreSQL.
---

**Rule:** In PostgreSQL lock-order tests, confirm each request is waiting in PostgreSQL before releasing a blocker. A later row-lock waiter may be blocked directly by an earlier queued request, rather than only by the transaction that originally held the row. Use `pg_blocking_pids` to verify the actual blocker relationship.

**Why:** While testing video deactivation against reward completion, PostgreSQL reported the completion waiter as blocked by the admin update already queued ahead of it. Checking only for the original test lock holder made the test miss the real wait.

**How to apply:** Gate each interleaving on observed lock waits, include queued backends when asserting blocker relationships, and create uniquely identified test rows that can be deleted by ID in `finally` cleanup.