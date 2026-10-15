---
name: Tournament lifetime-stat limits
description: Concurrency requirements for checking bounded player counters before tournament settlement.
---

**Rule:** Check all lifetime-stat increments before settlement writes, while holding the player's user row lock. Different tournaments can award the same player concurrently, so match-row locks alone do not serialize those totals.

**Why:** Two result transactions for separate matches could otherwise both read the same near-limit totals and each pass an overflow check before incrementing them.

**How to apply:** Keep the account lock held through the stats update and check every bounded counter against PostgreSQL's integer maximum before inserting an award, crediting the wallet, writing the ledger, or finalizing a match.
