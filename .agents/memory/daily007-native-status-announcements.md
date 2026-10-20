---
name: Daily007 native status announcements
description: Platform-specific React Native screen-reader announcements for changing status messages.
---

`accessibilityLiveRegion` does not provide VoiceOver announcements on iOS. Keep it for Android and use `AccessibilityInfo.announceForAccessibility` on iOS when a status changes. Give persistent guidance and actions explicit accessible labels so users can navigate to them independently.

**Why:** Retry start and outcome messages must be heard on both platforms without duplicate Android announcements or loss of the focused retry control.

**How to apply:** For transient status updates, retain the Android live region and gate imperative announcements to iOS; keep recovery controls as separate accessible elements.

On 2026-10-20, the user confirmed that incorrect-password feedback was announced clearly on Android TalkBack and iOS VoiceOver, focus did not unexpectedly move, and correcting the password allowed login. Exact spoken wording was not provided.

**Why:** Native speech and focus behavior cannot be confirmed by browser tests, and an audible error must leave the form recoverable for players using screen readers.

**How to apply:** Preserve the Android live-region and iOS explicit-announcement paths for Auth errors. Recheck announcement count, focus stability, and retry after changing Auth error handling.
