---
name: Daily007 offline session recovery
description: Native Android reconnect and foreground-resume behavior confirmed for saved sessions.
---

On an iQOO Neo 10 running Android 16, Daily007 automatically verifies a saved session after Wi-Fi/mobile data returns while the recovery screen is open, and after the app resumes from the background. A failed offline retry leaves the saved session available for another retry.

**Why:** Physical confirmation is needed because source checks alone cannot prove that Expo's Android network and app-state events fire as expected. Android can emit repeated online updates for one reconnect, and a retry started before the app is active may remain paused; suppressing the foreground retry after that event can block recovery.

**How to apply:** Deduplicate network retries at offline-to-online edges, but still query connectivity and retry when a backgrounded app returns to the foreground. Send both triggers through the same singleflight path, keep the saved session after transient verification failures, and re-run the three device checks when changing this flow.

The user also confirmed that the saved Daily007 sign-in survived a full Android reboot while offline and verified after connectivity returned.

**Why:** A full reboot exercises OS startup and persistent storage beyond force-stopping Expo Go.

**How to apply:** Keep full reboot recovery in the Android device regression checks when changing saved-session storage or startup verification.

When an authenticated app remains active, restored connectivity should also refresh account access so changed roles update navigation without waiting for the periodic refresh. Connectivity and app-resume triggers must share the coalesced refresh path.

**Why:** A player can regain network access without backgrounding the app, leaving role-specific screens stale until the next timer tick.

**How to apply:** Trigger the existing account-access refresh after an offline-to-online transition only while active, preserve the session on transport failures, and confirm native network events on Android when a device is available.
