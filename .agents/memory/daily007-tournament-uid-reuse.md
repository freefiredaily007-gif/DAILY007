---
name: Daily007 tournament UID reuse
description: Product rule for duplicate Free Fire UIDs during team edits across tournaments.
---

**Rule:** Only approved and pending registrations reserve a Free Fire UID, and only within the same tournament. Rejected entries, including refunded or cancelled registrations, do not reserve that UID even in the same tournament.

**Why:** The user explicitly set the product rule that UID conflicts are tournament-scoped.

**How to apply:** Keep team-edit duplicate checks scoped to the current tournament and limited to approved/pending registrations. Test cross-tournament reuse and reuse from a rejected entry in the same tournament, verifying the other registration and roster remain unchanged.
