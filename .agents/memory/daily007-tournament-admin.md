---
name: Daily007 Tournament Admin scope
description: User-defined permission boundary between full Admin and tournament-only Admin accounts.
---

A Tournament Admin can manage tournaments, registrations, rooms, results, and tournament winner payouts. They cannot manage general wallet credits, payment or recharge approvals, withdrawals, or earn-task reward approvals. Only a Full Admin assigns or removes Tournament Admin access directly in User Management; players do not self-request.

**Why:** The user chose all tournament operations, including registrations and room management, while explicitly excluding non-tournament coin approvals and withdrawals. They clarified that the main Full Admin must assign the role directly, not process player requests.

**How to apply:** Keep the boundary in both server authorization and Admin navigation. Treat User Management as the sole route for assigning the role. Do not expand tournament permissions to unrelated wallet or reward workflows.

**Tournament finish:** The Finish action opens result entry. Publishing a result awards the prize and closes registration in the same transaction; registered players see published standings in MY MATCHES → COMPLETED.

**Why:** The user asked for tournament admins to record results and award the winner when finishing a tournament, with results visible to players.

**How to apply:** Do not complete a tournament just by opening the form. Only expose completion after a result award commits.

**Prize source:** During result publication, derive the non-editable award from the tournament's saved prize distribution for the entered rank; if no first-place distribution is specified, use the saved prize pool. The API is the source of truth.

**Why:** The user asked for the creation-time winning prize to populate result publication without allowing admins to edit it there.

**How to apply:** Keep the displayed rank-based value and server-computed award aligned; never accept a client-provided prize amount as authoritative.

**Safe deletion:** Permanently delete only tournaments without registration, wallet, or result history. If history exists, close the tournament and preserve its records.

**Why:** Removing a tournament with participant or coin history could erase records players rely on.

**How to apply:** Check all related history before deleting; do not cascade-delete registrations, awards, or wallet entries.