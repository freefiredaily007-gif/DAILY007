---
name: Daily007 room credential release
description: Access and timing requirements for tournament Room IDs and passwords.
---

For Daily007 tournaments, saving the Room ID and password arms automatic release; there is no separate publish step. Only approved registrants may retrieve the credentials, and retrieval must remain blocked until five minutes before the tournament's scheduled start. Use the scheduled start as the clock, not the separate room-time field. The old manual-publish flag is not a disclosure gate: saved credentials should still release at the threshold. Enforce the rule on the server for every credential retrieval path; client-side countdowns are only for messaging and refresh behavior.

**Why:** The user requires room details to become available only to registered participants at the five-minute threshold, without manual publishing. Existing room entries should not need to be resaved just to adopt the new automatic-release behavior.

**How to apply:** Preserve the registration check and scheduled-start threshold when changing admin, player, compatibility, or v2 room flows.

## Native Android validation

On 2026-10-04, the user confirmed on an iQOO Neo 10 running Android 16 that approved test room details stayed hidden before start-minus-five-minutes and appeared at/after the boundary both while My Matches remained open and after leaving and reopening it.

On 2026-10-05, the user also confirmed on an iQOO Neo 10 running Android 16 that fake credentials for an approved non-production test registration stayed hidden before T−5 and appeared after Android backgrounded My Matches across the threshold and the app resumed, without navigation or manual refresh.

On 2026-10-06, the user confirmed on the same Android device that My Matches recovered automatically after connectivity returned while the screen remained open, without manual refresh or navigation; fake credentials for an approved non-production test registration stayed hidden until T−5.

**Why:** Server tests verify the access boundary, but only a physical Android device exercises the on-screen timer, navigation focus, and app-resume refresh together.

**How to apply:** Repeat both real-device checks—leaving/reopening My Matches and suspending across the threshold—after changes to room timing or refresh behavior; use only non-production test registrations and fake room credentials.