---
name: API PostgreSQL concurrency tests
description: Lock-order observations for integration tests that exercise API requests against PostgreSQL.
---

**Rule:** In PostgreSQL lock-order tests, confirm each request is waiting in PostgreSQL before releasing a blocker. A later row-lock waiter may be blocked directly by an earlier queued request, rather than only by the transaction that originally held the row. Use `pg_blocking_pids` to verify the actual blocker relationship.

**Why:** While testing video deactivation against reward completion, PostgreSQL reported the completion waiter as blocked by the admin update already queued ahead of it. Checking only for the original test lock holder made the test miss the real wait.

**How to apply:** Gate each interleaving on observed lock waits, include queued backends when asserting blocker relationships, and create uniquely identified test rows that can be deleted by ID in `finally` cleanup.

For duplicate-delivery races, hold the target session row, wait until the first request is blocked on it, then issue the second request and verify PostgreSQL reports it queued behind the first before releasing the blocker. Assert both responses and the final wallet, ledger, and session pointer.

**Why:** Launching two HTTP requests close together does not prove they overlapped at the database lock; a deterministic queue makes the duplicate-write ordering reproducible.

**How to apply:** Use `pg_blocking_pids` to establish the first/second wait relationship, release the blocker only after both requests are queued, and verify the loser returns the existing ledger entry without adding another one.

**Rule:** In fake-database race tests, model row locks at the same key granularity as production (for example, one lock per match and one per wallet owner); do not use a global mutex for independent rows.

**Why:** A global fixture mutex can serialize requests that should overlap in production, masking races across different matches or records.

**How to apply:** Before adding a concurrent test, identify each production `FOR UPDATE` row and give the fixture a corresponding keyed lock so it can prove which requests contend.

**Rule:** A snapshot-based fake database should refresh a transaction's rollback baseline after it acquires a row lock it had to wait for.

**Why:** A waiting transaction's begin-time snapshot can predate the lock owner's commit; restoring that stale whole-database snapshot on rollback can erase the earlier committed state.

**How to apply:** In per-key lock fixtures, after a waiter acquires the row lock and before running the locked query, refresh its rollback baseline from the current state. Keep the lock keyed to the production row.

**Local isolated clusters:** When starting a temporary PostgreSQL cluster in the Replit workspace, set `unix_socket_directories` to a writable directory owned by the test.

**Why:** The default `/run/postgresql` directory is absent here, so `pg_ctl` can fail after PostgreSQL begins listening on loopback.

**How to apply:** Pass `-c unix_socket_directories=<temporary-directory>` to the server startup options, bind TCP to `127.0.0.1`, and stop the cluster before removing its temporary directory.