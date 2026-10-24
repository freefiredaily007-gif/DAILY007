---
name: Daily007 Kill & Earn payout policy
description: Trusted kill verification, reward limits, payout timing, and correction rules for Kill & Earn matches.
---

- An Admin verifies each player's kills against Free Fire match-end evidence and matches the result to that player's registered in-game UID; client-reported counts are never authoritative.
- Cap each player at 47 verified kills and each tournament rate at 100 coins per kill, for a maximum 4,700-coin Kill & Earn reward per player.
- Release the kill reward only with an accepted Admin-published result. Android verification confirmed the wallet/ledger credit and that a retry reports already credited without changing the balance.
- Never republish a result to adjust a payout. A Full Admin correction updates the current verified count and lifetime kill total, then appends an auditable compensating wallet entry and reason; the original payout entry remains unchanged.

**Why:** Kill counts from clients are untrusted, and a mistaken or retried result must not silently over-credit a wallet or erase the original audit trail.

**How to apply:** Keep verification tied to official match evidence and the registered UID. Preserve each original reward entry and record the evidence review reason on the adjustment. If game limits or payout policy change, review both the server caps and existing awards before changing them.
