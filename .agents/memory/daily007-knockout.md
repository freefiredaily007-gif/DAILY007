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

The Knockout top-three prize schedule is fixed at 500/300/200 coins per squad, split evenly across four seats (125/75/50 each). Do not credit wallet coins until an authorized admin explicitly approves the final payout; wallet credit is not a cash transfer. Use atomic, idempotent per-registration ledger entries and retain an admin audit trail for corrections and payout actions.

**Why:** The user requires manual authorization, no automatic money movement, exact per-player shares, duplicate-credit protection, and an audit history.

**How to apply:** Snapshot only confirmed final winners, validate all 12 paid roster seats and the 1,000-coin pool before approval, then write wallet balances, ledger rows, and payout records together in one transaction.

Advance or eliminate squads only in one explicit, admin-authorized transaction after every eligible squad's result is published. Persist each squad's round outcome; if a tie remains at the advance/winner cutoff, require a recorded admin ordering and reason. Final confirmation publishes the top three and completes the match.

**Why:** The user requires a gated 12 → 10 → 8 → Final progression, no outcome changes from drafts, and no duplicate or unrecorded advancement decisions.

**How to apply:** Treat saved per-team progress as the source of stage eligibility. Lock result edits after transition; display pre-transition scores as provisional and only show official ranks after confirmation.
