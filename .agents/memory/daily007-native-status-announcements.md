---
name: Daily007 native status announcements
description: Platform-specific React Native screen-reader announcements for changing status messages.
---

`accessibilityLiveRegion` does not provide VoiceOver announcements on iOS. Keep it for Android and use `AccessibilityInfo.announceForAccessibility` on iOS when a status changes. Give persistent guidance and actions explicit accessible labels so users can navigate to them independently.

**Why:** Retry start and outcome messages must be heard on both platforms without duplicate Android announcements or loss of the focused retry control.

**How to apply:** For transient status updates, retain the Android live region and gate imperative announcements to iOS; keep recovery controls as separate accessible elements.
