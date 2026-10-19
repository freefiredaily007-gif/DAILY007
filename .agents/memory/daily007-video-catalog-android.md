---
name: Daily007 Android video catalog lifecycle
description: Native Android confirmation of video catalog refresh and polling behavior.
---

**Confirmed:** On 2026-10-19, the user reported all three checks passed on an iQOO Neo 10 running Android 16: a disabled video disappeared promptly after app resume, catalog polling paused while the player was open, and returning to the catalog triggered a refresh.

**Why:** The automated lifecycle test models these transitions but cannot confirm native Android AppState and navigation behavior.

**How to apply:** Treat warm background/resume, player-open polling pause, and refresh-on-return as confirmed on this device. Recheck native behavior after lifecycle changes; this does not verify iOS or force-stop/relaunch behavior.
