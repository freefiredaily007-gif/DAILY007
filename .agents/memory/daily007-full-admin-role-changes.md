---
name: Daily007 Full Admin role changes
description: Preserve at least one Full Admin when administrator role changes race.
---

Admin mutations take a shared transaction advisory gate before locking and rechecking the acting account; role changes take the exclusive gate before any actor or target-row locks. Hold each gate until commit, and check the last-Full-Admin invariant inside the exclusive transaction.

**Why:** Request-time authorization can become stale. Actor row locks alone can also deadlock when a mutation targets another administrator while that target is demoting the actor; the shared/exclusive gate provides one lock order and prevents writes after revocation.

**How to apply:** Keep the gate, actor-role check, mutation, and role update in their transactions. Cover both the in-flight mutation/demotion race and the last-administrator invariant.