---
name: Daily007 room credential release
description: Access and timing requirements for tournament Room IDs and passwords.
---

For Daily007 tournaments, saving the Room ID and password arms automatic release; there is no separate publish step. Only approved registrants may retrieve the credentials, and retrieval must remain blocked until five minutes before the tournament's scheduled start. Use the scheduled start as the clock, not the separate room-time field. The old manual-publish flag is not a disclosure gate: saved credentials should still release at the threshold. Enforce the rule on the server for every credential retrieval path; client-side countdowns are only for messaging and refresh behavior.

**Why:** The user requires room details to become available only to registered participants at the five-minute threshold, without manual publishing. Existing room entries should not need to be resaved just to adopt the new automatic-release behavior.

**How to apply:** Preserve the registration check and scheduled-start threshold when changing admin, player, compatibility, or v2 room flows.