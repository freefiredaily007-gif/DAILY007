---
name: Daily007 video rewards
description: Product rule for Full Admin-managed YouTube videos and repeatable per-view coin rewards.
---

**Rule:** Full Admins can add, activate, and deactivate managed YouTube videos. Credit one coin for every qualifying completed view, including replays; retries of the same playback must not credit again. A view qualifies when the YouTube ended event fires and estimated continuous playback reaches at least 75%; the server also requires at least 70% of the reported duration to elapse. Tournament Admins cannot manage the video catalog. Playback reports are client-reported and not tamper-proof.

**Why:** The user explicitly asked for a coin on each completed video view, including repeat views, Full Admin management, and a 75% playback threshold.

**How to apply:** Preserve role boundaries and per-session reward idempotency in future Daily007 video and wallet changes; describe playback qualification honestly.