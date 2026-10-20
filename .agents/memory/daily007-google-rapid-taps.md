---
name: Daily007 Android Google rapid taps
description: Physical Android verification of rapid-tap behavior during native Google provider launch.
---

On Android 16, repeated taps while the Google picker opened produced one provider screen; canceling made the button available again, and a retry completed one Daily007 sign-in.

**Why:** Deterministic handoff tests do not exercise real Android touch delivery while the native provider screen is launching.

**How to apply:** Keep an Android 16 device check for rapid taps, cancellation/retry, and single completion when changing Google sign-in launch behavior.
