---
name: Daily007 automatic underfilled tournament cancellation
description: Product rule for start-time cancellation and wallet refunds in Clash Squad and Lone Wolf.
---

**Rule:** At the scheduled start time, automatically cancel only underfilled Clash Squad and Lone Wolf tournaments. Full matches and other game modes are unaffected. Refund each registration's original entry fee to the account that paid it. Wallet history must show the tournament name, refund reason, and exact amount for new and historical refunds; if the tournament record is unavailable, show its ID clearly.

**Why:** The user explicitly requested automatic cancellation and full wallet refunds for these two modes only, with readable player-facing history and no duplicate entry after a repeated startup sweep. Process-local progress is lost on API restarts, which can let an earlier batch of failing tournaments starve later refunds; using the existing settings row avoids a schema migration.

**How to apply:** Compare active registrations with slot capacity, then update the tournament, wallet balances, and idempotent refund ledger entries in one transaction. Store the scheduler cursor as private metadata in the existing settings JSON, reload it at each sweep, preserve it across admin settings replacement, and keep it out of API responses. Advance it after every candidate with a 100-candidate batch cap, wrapping only after reaching the end. Store a player-readable description with each new refund, resolve older refund IDs while their tournament record exists, and keep Wallet history refreshes singular after repeat sweeps.

**Rule:** Cursor writes from separate API workers must be monotonic by `(startsAt, id)`. A wraparound reset to `null` must only apply if the persisted cursor still matches the cursor that worker observed.

**Why:** The in-process sweep guard does not coordinate separate workers; a slower worker can otherwise overwrite newer batch progress or clear it during wraparound.

**How to apply:** Compare candidate cursors atomically in the PostgreSQL JSONB update, and make cursor resets conditional on the expected prior position. Keep the batch size capped at 100 per worker.

**Test note:** A wraparound exhaustion test must leave no eligible candidates anywhere in the scan, not just after the saved cursor. The sweep restarts from the beginning after clearing the cursor, and even a match with zero active registrations is still underfilled.

**Why:** A test that leaves any underfilled match eligible observes a new cursor advance after the reset instead of the cleared cursor.

**How to apply:** Before asserting a persisted null cursor, make all candidates full or cancelled and verify the first-page query would be empty after wraparound.