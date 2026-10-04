---
name: Daily007 Full Admin role changes
description: Preserve at least one Full Admin when administrator role changes race.
---

Every role change that can demote a Full Admin must be serialized with a shared transaction lock, then re-check the remaining-admin invariant before updating the role.

**Why:** Authentication reads the actor's role before the role-change transaction begins. Two requests can both pass authorization before either commits, so request-time checks alone can allow competing demotions.

**How to apply:** Keep the lock and final-admin count check in the same transaction as the role update. Cover the stale-authorization race and verify the surviving administrator's role from a fresh user-list read.