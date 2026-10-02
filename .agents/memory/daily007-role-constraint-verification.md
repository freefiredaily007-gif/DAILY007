---
name: Daily007 database CHECK constraints
description: Verify development database CHECK constraints after schema changes.
---

**Rule:** A successful schema push does not guarantee the live development database's CHECK constraints were updated. Verify their actual definitions through the app's database connection after changing them.

**Why:** More than one Daily007 CHECK constraint remained stale after a reported successful schema push, blocking otherwise valid application operations.

**How to apply:** Query the actual constraint definitions before relying on the updated schema. Correct development drift directly when needed; production schema changes belong to the publish flow.