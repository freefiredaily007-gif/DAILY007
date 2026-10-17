---
name: TDetail Android resume verification
description: Physical Android verification of match-detail refresh behavior across background and resume.
---

On 2026-10-17, the user confirmed all three checks passed on Android 16:
- TDetail remained open and focused in the background without periodic match-detail reads.
- Returning to the active app while TDetail remained focused triggered one refresh with no duplicate read.
- Navigating away while backgrounded and resuming did not refresh the unfocused TDetail route.

**Why:** The automated lifecycle tests simulate focus and app-activity event ordering; they do not exercise native Android AppState events.

**How to apply:** Treat the current Android 16 native behavior as verified. Repeat the check if TDetail's AppState subscription, focus handling, or refresh controller changes.
