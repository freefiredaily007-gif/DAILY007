---
name: Daily007 API workflow recovery
description: Handles API artifact restarts that collide with an older process on port 8080.
---

**Rule:** If the managed API workflow fails on `EADDRINUSE`, do not immediately restart it again. Stop the exact artifact workflow, verify nothing listens on port 8080, then restart once and confirm `/api/healthz` responds.

**Why:** A failed restart left an older API process alive on the managed port; another restart reproduced the same failure until workflow/process state was cleared.

**How to apply:** Use this for Daily007 API restart conflicts. Keep it distinct from Expo/Metro's separate 8081 port isolation issue.