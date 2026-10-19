---
name: API PostgreSQL concurrency tests
description: Lock-order observations for integration tests that exercise API requests against PostgreSQL.
---

**Rule:** In PostgreSQL lock-order tests, confirm each request is waiting in PostgreSQL before releasing a blocker. A later row-lock waiter may be blocked directly by an earlier queued request, rather than only by the transaction that originally held the row. Use `pg_blocking_pids` to verify the actual blocker relationship.

**Why:** While testing video deactivation against reward completion, PostgreSQL reported the completion waiter as blocked by the admin update already queued ahead of it. Checking only for the original test lock holder made the test miss the real wait.

**How to apply:** Gate each interleaving on observed lock waits, include queued backends when asserting blocker relationships, and create uniquely identified test rows that can be deleted by ID in `finally` cleanup.

**Rule:** When `waitForBlockedBackend` matches SQL from `pg_stat_activity.query`, use a short contiguous fragment for multiline statements; the query text keeps its line breaks.

**Why:** A reconstructed one-line fragment did not match the permanent-delete query, causing the lock-order test to time out despite the request being queued.

**How to apply:** Inspect the live `pg_stat_activity.query` when a wait times out, then match a distinctive contiguous phrase and verify the blocker PID separately with `pg_blocking_pids`. Do not normalize across line breaks when forming the matcher.

For duplicate-delivery races, hold the target session row, wait until the first request is blocked on it, then issue the second request and verify PostgreSQL reports it queued behind the first before releasing the blocker. Assert both responses and the final wallet, ledger, and session pointer.

**Why:** Launching two HTTP requests close together does not prove they overlapped at the database lock; a deterministic queue makes the duplicate-write ordering reproducible.

**How to apply:** Use `pg_blocking_pids` to establish the first/second wait relationship, release the blocker only after both requests are queued, and verify the loser returns the existing ledger entry without adding another one.

**Rule:** An isolated PostgreSQL fixture used by an API route test must include every referenced column and joined relation in the route's query, including optional `LEFT JOIN`s exercised by follow-on requests.

**Why:** A video-reward race test passed its reward writes but then failed reading Wallet history because the minimal schema omitted the history query's registration field and awards relation.

**How to apply:** Trace every endpoint called by the integration test through its SQL, and model empty joined tables as well as rows directly mutated by the scenario.

For idempotent create races, gate the first matching insert with a test-only trigger and transaction-scoped advisory lock; let a second request commit the unique-key row before releasing the first.

**Why:** This deterministically exercises `INSERT ... ON CONFLICT DO NOTHING` for overlapping start requests and proves the blocked request reuses the committed row.

**How to apply:** Use a sequence so only the first matching trigger invocation waits, observe its insert blocked in PostgreSQL, then assert the second returns created and the first returns reused with the same row ID.

For a protected action queued behind an account block, pause the block only after it owns the actor's row lock; do not rely on seeing a compatible `FOR SHARE` role check blocked by a block request that is itself waiting.

**Why:** In PostgreSQL, the attempted lock-queue probe did not report the second role check as blocked by the earlier `FOR UPDATE` waiter, so it could not prove the intended order.

**How to apply:** Let the in-flight protected action finish, hold the block's status update before commit with a test advisory lock, start the second protected request, and verify `pg_blocking_pids` links its role check to the active block update.

For concurrent video sessions owned by one player, use different videos when isolating contention at the shared wallet row. Separately, use one shared video and separate players to prove video-state reads do not serialize independent wallet updates.

**Why:** A shared video lock can otherwise serialize different players before their independent wallet updates, masking unnecessary contention.

**How to apply:** For wallet contention, hold one player's wallet while different-video sessions wait, then verify each idempotency-keyed ledger link. For same-video independence, hold one player's wallet and assert the other player's completion finishes before releasing it; verify both rewards and session-to-ledger links.

For concurrent wallet debits on different matches with different fees, correlate each response and ledger row by match or registration; do not assume request-array order determines which debit acquires the wallet lock first.

**Why:** PostgreSQL may serialize either request first, so comparing sorted balances alone can miss a fee recorded against the wrong tournament.

**How to apply:** Assert each match's configured and paid fee, map its response balance to its ledger entry, and verify the ledger balance chain from the starting balance to the final wallet value.

For concurrent tournament payouts to one player across different matches, hold the player's wallet row until both result requests are waiting on that row; then verify both awards, the full wallet-ledger balance chain, and accumulated stats.

**Why:** The requests lock independent tournament rows, so a shared-wallet blocker is needed to prove overlap at the serialization point that protects both balance and stats updates.

**How to apply:** Match `pg_stat_activity` against the wallet `FOR UPDATE` query, confirm both waiters are blocked by the test lock or each other, then release and assert each configured prize persisted once.

For a password-login race with an account block, hold an uncommitted status update on the account row, start a valid login, and wait until its session-version update is blocked by that transaction before committing the block.

**Why:** This proves the credential lookup already succeeded and exercises PostgreSQL's real recheck of the `status = 'active'` update predicate after the queued row lock is released.

**How to apply:** Correlate the waiting auth-version update to the blocker PID through `pg_blocking_pids`, commit the blocked status, then assert a generic login failure, no token, and an unchanged auth version.

For authenticated player writes, recheck and lock the account status inside the same transaction as the write; middleware authentication alone can become stale before commit.

**Why:** A block can commit after middleware has accepted a request but before its registration or team-edit transaction reaches the durable write.

**How to apply:** Lock the player row in the write transaction, reject blocked status before mutating data, and test by holding an uncommitted block update until the request is observed waiting via `pg_blocking_pids`.

**Rule:** When expanding a concurrency test to a new registration mode, retain prior mode coverage when it exercises a distinct write path.

**Why:** Team signups add roster writes; replacing a solo race with a team race would lose regression coverage for wallet-only registrations.

**How to apply:** Share the race setup where practical, and assert mode-specific persisted state (team roster rows for duo, none for solo).

To exercise an isolated PostgreSQL write failure without mocking the transaction, add a temporary CHECK constraint scoped to the fixture's exact ledger idempotency key and reward reason. Drop it in `finally` after the request settles.

**Why:** The targeted constraint fails only the intended ledger insert, allowing the test to prove the preceding wallet update rolls back while unrelated ledger writes remain unaffected.

**How to apply:** Use a generated safe constraint name and unique session key, expect an HTTP failure, verify wallet/ledger/session state is unchanged, then drop the constraint and clean up the fixture.

For a one-shot PostgreSQL failure that must be followed by a successful retry, use a sequence to gate the first trigger execution rather than a transactional table flag.

**Why:** Sequence increments survive transaction rollback, while a flag change made inside the failed transaction rolls back and would cause the retry to fail again.

**How to apply:** Increment a fixture-owned sequence for the targeted ledger row, pause and raise only when `nextval` returns its first value, then remove the trigger, function, and sequence after all requests settle.

To prove concurrent requests contend on a globally unique key, hold an uncommitted row with that key, start both requests, verify both inserts are lock-waiting in PostgreSQL, then roll back the blocker.

**Why:** Promise-based request fan-out alone does not establish that both requests reached the database before either finished.

**How to apply:** Confirm both inserts are visible as lock waiters and linked to the blocker or each other before releasing it; then assert one insert succeeds, the other maps the unique violation to a conflict, and only one row persists.

For idempotent API requests serialized by a PostgreSQL advisory lock, hold that same key in a separate transaction, start both requests, and verify both are lock waiters before releasing it.

**Why:** Starting concurrent HTTP requests alone does not prove they overlapped at the idempotency boundary; holding the real key deterministically brings both to that point before either can commit.

**How to apply:** Use the production key derivation in the test blocker, count both waiting statements through `pg_stat_activity` and `pg_blocking_pids()`, release the transaction, then assert successful equivalent responses and one durable effect.

**Rule:** In fake-database race tests, model row locks at the same key granularity as production (for example, one lock per match and one per wallet owner); do not use a global mutex for independent rows.

**Why:** A global fixture mutex can serialize requests that should overlap in production, masking races across different matches or records.

**How to apply:** Before adding a concurrent test, identify each production `FOR UPDATE` row and give the fixture a corresponding keyed lock so it can prove which requests contend.

**Rule:** A snapshot-based fake database should refresh a transaction's rollback baseline after it acquires a row lock it had to wait for.

**Why:** A waiting transaction's begin-time snapshot can predate the lock owner's commit; restoring that stale whole-database snapshot on rollback can erase the earlier committed state.

**How to apply:** In per-key lock fixtures, after a waiter acquires the row lock and before running the locked query, refresh its rollback baseline from the current state. Keep the lock keyed to the production row.

**Local isolated clusters:** When starting a temporary PostgreSQL cluster in the Replit workspace, set `unix_socket_directories` to a writable directory owned by the test.

**Why:** The default `/run/postgresql` directory is absent here, so `pg_ctl` can fail after PostgreSQL begins listening on loopback.

**How to apply:** Pass `-c unix_socket_directories=<temporary-directory>` to the server startup options, bind TCP to `127.0.0.1`, and stop the cluster before removing its temporary directory.

When multiple reward transactions hold compatible `FOR SHARE` locks, do not require a later admin update's `pg_blocking_pids()` result to list every lock holder.

**Why:** In a PostgreSQL race with two reward requests each already waiting on a separate wallet row, the queued video update reported only one of the two shared-lock owners as a blocker.

**How to apply:** First observe every reward request blocked at its own wallet query, proving each progressed beyond the video active-state lock; then verify the admin update is queued behind a reward transaction without requiring an exhaustive blocker list.