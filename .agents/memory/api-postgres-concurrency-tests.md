---
name: API PostgreSQL concurrency tests
description: Lock-order observations for integration tests that exercise API requests against PostgreSQL.
---

**Rule:** In PostgreSQL lock-order tests, confirm each request is waiting in PostgreSQL before releasing a blocker. A later row-lock waiter may be blocked directly by an earlier queued request, rather than only by the transaction that originally held the row. Use `pg_blocking_pids` to verify the actual blocker relationship.

**Why:** While testing video deactivation against reward completion, PostgreSQL reported the completion waiter as blocked by the admin update already queued ahead of it. Checking only for the original test lock holder made the test miss the real wait.

**How to apply:** Gate each interleaving on observed lock waits, include queued backends when asserting blocker relationships, and create uniquely identified test rows that can be deleted by ID in `finally` cleanup.

**Local isolated clusters:** When starting a temporary PostgreSQL cluster in the Replit workspace, set `unix_socket_directories` to a writable directory owned by the test.

**Why:** The default `/run/postgresql` directory is absent here, so `pg_ctl` can fail after PostgreSQL begins listening on loopback.

**How to apply:** Pass `-c unix_socket_directories=<temporary-directory>` to the server startup options, bind TCP to `127.0.0.1`, and stop the cluster before removing its temporary directory.