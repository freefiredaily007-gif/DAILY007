---
name: Android fixture scroll clearance
description: Keep Maestro's bottom-of-screen interactions clear of persistent Expo development warning overlays.
---

For Android UI fixtures, `scrollUntilVisible` can treat a control as visible even when a persistent Expo warning toast overlaps its lower edge. If the fixture's content fits the viewport, an explicit swipe cannot move the control because the `ScrollView` has no scroll range. Later rows can also be absent from Maestro's accessibility tree until a short swipe brings them into view.

**Why:** Android CI showed Maestro locating and tapping the final leaderboard control, but its press did not activate while a require-cycle warning overlay sat over the control's edge.

**How to apply:** Give test-only fixture content enough trailing scroll space to move bottom controls above persistent overlays, then swipe before tapping. For long Android lists, require 100% visibility; center later rows when they need repositioning, but do not force-center an already fully visible first row. Keep production layout unchanged and avoid globally suppressing warnings.
