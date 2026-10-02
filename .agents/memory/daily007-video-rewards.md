---
name: Daily007 video rewards
description: Product rule for Full Admin-managed YouTube videos and repeatable per-view coin rewards.
---

**Rule:** Full Admins can add, activate, and deactivate managed YouTube videos. Credit one coin for every qualifying completed view, including replays; retries of the same playback must not credit again. Tournament Admins cannot manage the video catalog. The reward check uses YouTube player events plus client-reported playback and is not tamper-proof.

**Why:** The user explicitly asked for a coin on each completed video view, including repeat views, and specified Full Admin management.

**How to apply:** Preserve role boundaries and per-session reward idempotency in future Daily007 video and wallet changes; describe playback qualification honestly.