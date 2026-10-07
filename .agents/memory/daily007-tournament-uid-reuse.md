---
name: Daily007 tournament UID reuse
description: Product rule for duplicate Free Fire UIDs during team edits across tournaments.
---

**Rule:** Free Fire UID conflicts are limited to active registrations in the same tournament. An approved or pending registration in another tournament must not block a team edit or have its registration or roster changed.

**Why:** The user explicitly set the product rule that UID conflicts are tournament-scoped.

**How to apply:** Keep team-edit duplicate checks scoped to the current tournament. Cross-tournament tests should seed another tournament with an approved or pending registration using a submitted captain or teammate UID and verify the other registration and roster remain unchanged.
