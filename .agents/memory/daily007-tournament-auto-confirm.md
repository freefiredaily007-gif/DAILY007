---
name: Daily007 tournament auto-confirmation
description: Product rule for confirming tournament registrations and deducting entry fees.
---

**Rule:** Confirm new tournament registrations immediately when the user joins. Deduct any entry coins once in the same transaction; free tournaments confirm without a charge. Lock the match row before counting open slots so simultaneous joins cannot both claim the last one.

**Why:** The user requested direct confirmation and wallet deduction instead of waiting for admin approval. A last-slot race must not overbook a tournament or charge the losing player.

**How to apply:** Lock the match row, re-count approved and pending registrations, then keep registration confirmation, wallet update, ledger entry, and full-status update atomic. If capacity is gone, reject before writing the losing player's registration or wallet ledger. Preserve older pending registrations for admin review unless the user explicitly asks to change them.

**Capacity UI:** Treat the live player-seat count as authoritative. For individual-seat team formats, a team being occupied does not mean the team or match is full; only disable joining when all player seats are claimed. Stale `full` or `setup_needed` flags must not override an under-capacity player count.

**Why:** Teams can reach their configured count while still having open seats, and stale full-state flags previously blocked valid joins.

**How to apply:** Use player occupancy for client availability and server capacity checks, while still rejecting occupied seats, closed lifecycle states, duplicate registrations, and insufficient balance. Use status flags only when a live player-capacity count is unavailable.

**Format-edit rule:** While active registrations exist, keep edits within the same game mode. A team-format change is safe only when the active player count fits the new capacity and every active seat remains within the new team and slot bounds. Rejected and removed entries must not reserve active capacity.

**Why:** Admin format edits must not discard joined players' seat assignments or let inactive registrations block a valid reduction.

**How to apply:** Before saving a format change, count approved and pending players, then verify their existing team and slot coordinates against the target format. Keep the match unchanged when either check fails.