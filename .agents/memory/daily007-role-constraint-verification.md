---
name: Daily007 role constraint verification
description: A development database check constraint did not update despite Drizzle Kit reporting success.
---

After a Daily007 role CHECK constraint change, verify the actual development database definition through the app's connection; `push-force` reported success while the role constraint remained unchanged in this environment.

**Why:** The stale constraint would reject assigning the new role even though application code and schema source accepted it.

**How to apply:** Verify the development database after schema changes. Keep production DDL out of band; production schema changes belong to the publish flow.