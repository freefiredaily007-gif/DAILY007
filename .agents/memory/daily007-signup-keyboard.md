---
name: Daily007 signup keyboard behavior
description: User-reported Android IME behavior for signup field navigation and Create Account reachability.
---

**Rule:** On 2026-10-06, the user reported that on an iQOO Neo 10 running Android 16, keyboard Next moved through Name, Referral, Email, and Password while each field stayed visible; Done dismissed the keyboard and left Create Account reachable. The native viewport size was not reported.

**Why:** The isolated browser test simulates Enter and a 375×720 viewport, but cannot establish Android IME behavior.

**How to apply:** When changing signup inputs or keyboard-aware scrolling, preserve this native Next/Done flow and distinguish handset results from the browser's simulated viewport.
