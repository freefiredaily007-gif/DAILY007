---
name: Daily007 Android video catalog lifecycle
description: Native Android confirmation of video catalog lifecycle and offline cached-card behavior.
---

**Confirmed:** On 2026-10-19, the user reported all three checks passed on an iQOO Neo 10 running Android 16: a disabled video disappeared promptly after app resume, catalog polling paused while the player was open, and returning to the catalog triggered a refresh.

**Confirmed:** The user also reported that an offline refresh displayed the warning while previously loaded cards remained visible and tappable, and selecting a cached video opened its player screen.

**Confirmed:** On 2026-10-19, the user reported the warning disappeared without pressing Reload and the refreshed video list appeared after connectivity returned.

**Why:** Automated query tests cannot confirm native Android AppState, network interruptions, or actual player navigation.

**How to apply:** Treat warm background/resume, player-open polling pause, refresh-on-return, opening a cached card after a failed offline refresh, and automatic warning/list recovery as confirmed on this device. Recheck native behavior after lifecycle changes; this does not verify iOS or force-stop/relaunch behavior.
