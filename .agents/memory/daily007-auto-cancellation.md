---
name: Daily007 automatic underfilled tournament cancellation
description: Product rule for start-time cancellation and wallet refunds in Clash Squad and Lone Wolf.
---

**Rule:** At the scheduled start time, automatically cancel only underfilled Clash Squad and Lone Wolf tournaments. Full matches and other game modes are unaffected. Refund each registration's original entry fee to the account that paid it.

**Why:** The user explicitly requested automatic cancellation and full wallet refunds for these two modes only.

**How to apply:** Compare active registrations with slot capacity, then update the tournament, wallet balances, and idempotent refund ledger entries in one transaction. A missed start-time check must be caught up after an API restart, without issuing duplicate refunds.