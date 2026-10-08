---
name: Daily007 offline session recovery
description: Native Android reconnect and foreground-resume behavior confirmed for saved sessions.
---

On an iQOO Neo 10 running Android 16, Daily007 automatically verifies a saved session after Wi-Fi/mobile data returns while the recovery screen is open, and after the app resumes from the background. A failed offline retry leaves the saved session available for another retry.

**Why:** Physical confirmation is needed because source checks alone cannot prove that Expo's Android network and app-state events fire as expected.

**How to apply:** Preserve automatic retry on connectivity restoration, re-check connectivity when the app returns to the foreground, and keep the saved session after transient verification failures. Re-run the three device checks when changing this flow.

When an authenticated app remains active, restored connectivity should also refresh account access so changed roles update navigation without waiting for the periodic refresh. Connectivity and app-resume triggers must share the coalesced refresh path.

**Why:** A player can regain network access without backgrounding the app, leaving role-specific screens stale until the next timer tick.

**How to apply:** Trigger the existing account-access refresh after an offline-to-online transition only while active, preserve the session on transport failures, and confirm native network events on Android when a device is available.
