---
name: PostgreSQL trigger lock assertions
description: Reliable concurrency-test assertions for locks held or awaited inside PostgreSQL triggers.
---

For concurrency tests that pause a transaction inside a trigger, do not rely only on `pg_stat_activity.query` text to identify both sides of the wait. A session inside a trigger can expose its internal statement rather than the outer DML. Capture the paused transaction's backend PID and use `pg_blocking_pids()` to confirm the intended competing transaction is blocked by it.

**Why:** String-based query filters did not consistently identify the waiter/blocker relationship for overlapping leaderboard payouts paused by an advisory lock in a wallet-ledger trigger.

**How to apply:** In isolated PostgreSQL tests, confirm the first transaction reached its trigger pause, capture its PID, and poll `pg_blocking_pids()` for the second transaction before releasing the test lock. Release the lock in an inner `finally` before closing the HTTP server so a failed assertion cannot hang server shutdown.
