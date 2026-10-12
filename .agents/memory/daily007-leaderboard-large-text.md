---
name: Daily007 leaderboard large text
description: Preserve the leaderboard's Android text-size breakpoint and wrapping behavior below it.
---

**Rule:** Keep the stacked leaderboard layout at 1.5× text scale. Below that breakpoint, let compact podium scores and expanded player names wrap inside their cards instead of truncating content or moving the threshold.

**Why:** The 1.49× preview exposed podium score text escaping narrow cards and expanded player names being forced to one line. Moving the breakpoint earlier would avoid the boundary rather than verify it.

**How to apply:** When changing the leaderboard, test Weekly and Monthly at 1.49× and 1.5× around the breakpoint, plus 2× on Android. Check text against its card bounds, all expanded Top 20 fields, and rank-20 scrolling.