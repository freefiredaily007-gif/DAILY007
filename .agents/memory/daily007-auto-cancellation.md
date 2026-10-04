---
name: Daily007 automatic underfilled tournament cancellation
description: Product rule for start-time cancellation and wallet refunds in Clash Squad and Lone Wolf.
---

**Rule:** At the scheduled start time, automatically cancel only underfilled Clash Squad and Lone Wolf tournaments. Full matches and other game modes are unaffected. Refund each registration's original entry fee to the account that paid it, and show a readable Wallet entry with the tournament name, refund reason, and exact amount.

**Why:** The user explicitly requested automatic cancellation and full wallet refunds for these two modes only, with readable player-facing history and no duplicate entry after a repeated startup sweep.

**How to apply:** Compare active registrations with slot capacity, then update the tournament, wallet balances, and idempotent refund ledger entries in one transaction. Store a player-readable description with each refund and ensure Wallet history refreshes show only one entry after a repeat sweep.