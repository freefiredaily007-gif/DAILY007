---
name: Daily007 tournament seat assignments
description: Rules for keeping selected team and player slots stable across tournament formats.
---

In every team tournament, each player registers individually into one explicitly selected team and seat, providing only their own in-game name and UID. Solo players persist their selected seat. Keep legacy whole-team records readable and unchanged.

**Why:** The user chose persistence of the exact selected seat; occupied seats must stay consistent across users and app restarts, while each member controls only their own registration details.

**How to apply:** Validate both team and seat under the match lock, reject occupied seats before charging, and use saved seat positions for all mode-specific participant views. Preserve whole-team editing for existing legacy registrations.
