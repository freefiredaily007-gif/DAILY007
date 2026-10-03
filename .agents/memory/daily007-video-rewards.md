---
name: Daily007 video rewards
description: Product rule for Full Admin-managed YouTube videos and repeatable per-view coin rewards.
---

**Rule:** Full Admins manage video titles, topics, and active state. The player-facing catalog is searchable by title and topic and shows both on each card. Selecting a card opens the embedded in-app YouTube player so completion can be tracked; do not send catalog taps directly to external YouTube. Credit one coin for every qualifying completed view, including replays; retries of the same playback must not credit again. A view qualifies when the YouTube ended event fires and estimated continuous playback reaches at least 75%; the server also requires at least 70% of the reported duration to elapse. Tournament Admins cannot manage the video catalog. Playback reports are client-reported and not tamper-proof.

**Why:** The user explicitly asked for a coin on each completed video view, including repeat views, Full Admin management, and a 75% playback threshold. They selected the searchable title/topic card design and required card selection to stay in-app so reward tracking remains available.

**How to apply:** Preserve role boundaries and per-session reward idempotency in future Daily007 video and wallet changes; keep title/topic search and the in-app player flow; describe playback qualification honestly.