---
name: Daily007 video rewards
description: Product rule for Full Admin-managed YouTube videos and repeatable per-view coin rewards.
---

**Rule:** Full Admins manage video titles, topics, YouTube links, and active state, and choose per video whether to hide it or permanently delete it. A video with any watch-session history cannot be permanently deleted; a YouTube link cannot be changed after watch history exists. The player-facing catalog is searchable by title and topic and shows both on each card. Selecting a card opens the embedded in-app YouTube player so completion can be tracked; do not send catalog taps directly to external YouTube. Credit one coin for every qualifying completed view, including replays; retries of the same playback must not credit again. A view qualifies when the YouTube ended event fires and estimated continuous playback reaches at least 75%; the server also requires at least 70% of the reported duration to elapse. Recheck and shared-lock the video's current active state during completion before any wallet or reward-ledger write; exclusively lock only the completing session so different players watching the same video can proceed independently. A session started while active does not authorize a reward after the video is disabled. The player must not offer a retry for this permanent rejection and should refresh the active catalog when returning. Tournament Admins cannot manage the video catalog. Playback reports are client-reported and not tamper-proof.

**Why:** The user explicitly asked for a coin on each completed video view, including repeat views, Full Admin management, and a 75% playback threshold. They selected the searchable title/topic card design, required card selection to stay in-app so reward tracking remains available, and said Admins should decide between hiding and permanent deletion. Admins can disable videos during playback, so a session's start-time state cannot authorize a later reward.

**How to apply:** Preserve role boundaries and per-session reward idempotency in future Daily007 video and wallet changes; lock the session row, then shared-lock and recheck video active state in the completion transaction before writes; keep title/topic search and the in-app player flow; block destructive edits when they would detach existing watch/reward history; describe playback qualification honestly. Count watch progress only between foreground playback samples, clear the sample baseline when app state leaves active, and never extrapolate across a long sample gap.

## Native Android player validation

On 2026-10-04, the user verified on an iQOO Neo running Android 16 that a filtered catalog card opened inside Daily007, YouTube controls rendered and playback started, and system Back returned to the same filtered catalog with its search text intact.

**Why:** React Native Web's iframe path does not exercise the native WebView, external-app routing, or Android hardware Back.

**How to apply:** Keep catalog taps in the in-app player, handle Android Back while the Video tab is focused and the player is open, and leave the catalog search state unchanged. Repeat this device check after changes to native playback or navigation.

On 2026-10-05, the user confirmed on Android that watch progress did not increase for time spent with the app locked or backgrounded, foreground playback advanced the estimate again, and a qualifying completed view credited exactly one coin.

**Why:** The user reported passing the screen-lock, resumed-progress, and one-coin reward checks on a real Android device.

**How to apply:** Repeat this device check after changes to the Video screen's AppState handling, embedded YouTube playback, or reward completion flow.

On 2026-10-09, the user confirmed on an iQOO Neo 10 running Android 16 that TalkBack announced a failed video-watch start once, kept focus usable on the player screen, and did not offer a coin-claim retry.

**Why:** Native TalkBack speech and focus behavior cannot be established from source assertions or a browser preview alone.

**How to apply:** Repeat this device check after changing the video-start error announcement, player focus behavior, or retry controls.