---
name: Daily007 Knockout tournament architecture
description: Integration boundary for the staged Knockout feature and future result processing.
---

Keep Knockout tournaments on the existing tournament match, registration, and wallet transaction flows. The per-match Knockout settings record configures stages; it is not a parallel registration or wallet system.

Count a squad as confirmed only when all four existing seats have approved registrations and each recorded payment covers the match entry fee. Enter one squad-level kill total per round; only published results affect public standings, and each squad and placement must be unique within a round.

**Why:** These rules were explicitly chosen to keep team completion tied to the existing per-player payment ledger and prevent draft scores or duplicate placements from appearing as official results.

**How to apply:** Derive confirmation from match registrations and payments; validate and save each round result atomically, and expose only published scores to player-facing standings.

**Why:** The user asked to preserve existing authentication, joining, captain controls, entry fees, and wallet behavior. A match-scoped settings record also keeps historical stage configuration stable.

**How to apply:** Build later stage results and advancement against the same tournament match and its saved settings. Credit prizes only through the existing wallet ledger and authenticated admin transaction path.
