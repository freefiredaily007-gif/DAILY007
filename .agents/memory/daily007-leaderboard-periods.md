---
name: Daily007 leaderboard periods
description: Match-date attribution and the weekly/monthly approval and payout lifecycle.
---

Leaderboard awards belong to the IST week or month containing the tournament's scheduled start time, not the later time when an administrator publishes results. Full Admin approval snapshots the standings and pays configured ranks atomically; the next cycle must not become active before that approval.

**Why:** Tournament results can be published after the match, so award creation time can put an earlier match into a later cycle. Freezing the ranking at approval keeps completed standings and payouts stable.

**How to apply:** When extending these leaderboards, attribute result awards through the match's `starts_at` and preserve the approval gate and transactional snapshot/payout behavior. Admins should wait for all cycle results to be published before approval.