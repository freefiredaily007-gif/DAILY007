---
name: Daily007 leaderboard screen readers
description: Native Android TalkBack and iOS VoiceOver confirmation for leaderboard entries, stale-refresh warnings, and podium updates.
---

On 2026-10-06, the user confirmed on an iQOO Neo 10 running Android 16 that TalkBack reads the Weekly and Monthly leaderboard entries clearly through Top 20, without confusing duplicate announcements from decorative avatars or coin icons.

On 2026-10-14, the user confirmed that the TalkBack check for stale leaderboard results and recovery passed.

On 2026-10-07, the user confirmed that iOS VoiceOver reads the Weekly and Monthly podium and expanded Top 20 entries clearly, without confusing duplicate announcements from decorative avatars or coin icons.

On 2026-10-14, the user reported that the VoiceOver podium-refresh check was good.

**Why:** Source-level accessibility labels cannot prove how Android TalkBack traverses the native accessibility tree.

**How to apply:** Repeat native TalkBack and VoiceOver verification if leaderboard row grouping, labels, decorative elements, stale-refresh warnings, or podium announcements change.
