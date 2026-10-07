---
name: Daily007 invite recovery TalkBack
description: Physical TalkBack confirmation for failed referral-browser-open recovery.
---

On 2026-10-07, the user confirmed the invite recovery TalkBack check was good on an iQOO Neo 10 running Android 16: the copy/share recovery instruction was announced after a rejected browser open, not when Earn first rendered, and not after a successful open.

**Why:** Source-level tests can check callback wiring and call counts, but cannot confirm native TalkBack speech.

**How to apply:** Recheck on Android if the referral open failure path, recovery message, or accessibility announcement changes.
