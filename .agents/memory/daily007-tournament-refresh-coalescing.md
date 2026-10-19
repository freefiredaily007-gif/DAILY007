---
name: Daily007 tournament refresh coalescing
description: Keep manual pulls from duplicating an in-flight app-resume, connectivity, or scheduled tournament refresh.
---

Manual pulls on the tournament list should supersede an in-flight scheduled poll, but join focus, app-resume, or connectivity recovery loads. The latest-request guard prevents the older poll response from replacing the newer pull result.

**Why:** A pull during resume recovery should share that request's outcome, while a slow periodic poll must not delay a user's explicit refresh.

**How to apply:** Keep the active trigger and latest-request guard aligned. Cover the scheduled-poll/manual-pull race by resolving the pull first and the stale poll last; separately retain app-resume/manual-pull coalescing and native gesture coverage.
