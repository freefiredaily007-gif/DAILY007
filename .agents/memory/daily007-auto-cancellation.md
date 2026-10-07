---
name: Daily007 automatic underfilled tournament cancellation
description: Product rule for start-time cancellation and wallet refunds in Clash Squad and Lone Wolf.
---

**Rule:** At the scheduled start time, automatically cancel only underfilled Clash Squad and Lone Wolf tournaments. Full matches and other game modes are unaffected. Refund each registration's original entry fee to the account that paid it. Wallet history must show the tournament name, refund reason, and exact amount for new and historical refunds; if the tournament record is unavailable, show its ID clearly.

**Why:** The user explicitly requested automatic cancellation and full wallet refunds for these two modes only, with readable player-facing history and no duplicate entry after a repeated startup sweep. Process-local progress is lost on API restarts, which can let an earlier batch of failing tournaments starve later refunds; using the existing settings row avoids a schema migration.

**How to apply:** Compare active registrations with slot capacity, then update the tournament, wallet balances, and idempotent refund ledger entries in one transaction. Store the scheduler cursor as private metadata in the existing settings JSON, reload it at each sweep, preserve it across admin settings replacement, and keep it out of API responses. Advance it after every candidate with a 100-candidate batch cap, wrapping only after reaching the end. Store a player-readable description with each new refund, resolve older refund IDs while their tournament record exists, and keep Wallet history refreshes singular after repeat sweeps.