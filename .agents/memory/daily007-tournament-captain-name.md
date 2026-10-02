---
name: Daily007 tournament captain name
description: Product rule for the captain name shown and submitted during tournament registration.
---

**Rule:** Tournament registration uses the captain's Daily007 application profile name as the captain name. Show it read-only; keep Free Fire in-game name and UID as separate registration fields. If the profile name is missing, direct the user to add it to their profile.

**Why:** The user asked to replace the separate captain real-name entry with the application profile name.

**How to apply:** Keep the read-only display sourced from the current Daily007 user profile and submit that same value as the captain's player name.

**Played-match results:** Show the Free Fire game name as the prominent winner name, the Daily007 profile name beneath it, and retain rank, avatar initial, kills, and prize coins in the row.

**Why:** The user provided a played-match screenshot as the reference for winner-name presentation.

**How to apply:** Use `gameName` for the primary line and `playerName` for the secondary line when both are available.