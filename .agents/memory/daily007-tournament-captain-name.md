---
name: Daily007 tournament captain name
description: Product rule for the captain name shown and submitted during tournament registration.
---

**Rule:** Tournament registration uses the authenticated Daily007 account's profile name as the captain name; do not trust a client-supplied captain/player name. Show the profile name read-only, keep Free Fire name, UID, team name, and teammate details separate, and require a nonblank profile name before starting a registration charge.

**Why:** The user asked to prevent client values and empty profiles from making saved captain names drift from the Daily007 profile.

**How to apply:** Derive the saved captain name from the authenticated account on both v2 and legacy registration paths. Keep the mobile read-only display sourced from the current profile and submit that same value for compatibility.

**Played-match results:** Show the Free Fire game name as the prominent winner name, the Daily007 profile name beneath it, and retain rank, avatar initial, kills, and prize coins in the row.

**Why:** The user provided a played-match screenshot as the reference for winner-name presentation.

**How to apply:** Use `gameName` for the primary line and `playerName` for the secondary line when both are available.