---
name: Daily007 tournament auto-confirmation
description: Product rule for confirming tournament registrations and deducting entry fees.
---

**Rule:** Confirm new tournament registrations immediately when the user joins. Deduct any entry coins once in the same transaction; free tournaments confirm without a charge. Lock the match row before counting open slots so simultaneous joins cannot both claim the last one.

**Why:** The user requested direct confirmation and wallet deduction instead of waiting for admin approval. A last-slot race must not overbook a tournament or charge the losing player.

**How to apply:** Lock the match row, re-count approved and pending registrations, then keep registration confirmation, wallet update, ledger entry, and full-status update atomic. If capacity is gone, reject before writing the losing player's registration or wallet ledger. Preserve older pending registrations for admin review unless the user explicitly asks to change them.

**Capacity UI:** When a tournament reaches maximum capacity, show the join action as disabled and label it “Slots Full.”

**Why:** The user requested clear feedback when a tournament has no remaining slots.

**How to apply:** Keep the capacity check on the server; show the disabled state on tournament cards and details.