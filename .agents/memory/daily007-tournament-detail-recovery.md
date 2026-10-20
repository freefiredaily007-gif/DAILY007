---
name: Daily007 tournament detail registration recovery
description: Keep detail content available during an initial registration lookup failure without losing a previously confirmed join state.
---

**Rule:** If the first registration lookup fails, show tournament details with entry status unknown and joining disabled. If a later lookup fails after a confirmed status, preserve that snapshot and show retry guidance; never treat a failed lookup as “not joined.”

**Why:** Hiding otherwise available tournament details is unnecessary, while treating a network or malformed-response failure as unjoined can invite a duplicate registration.

**How to apply:** Only update the detail snapshot after a valid registration response when a confirmed snapshot already exists. Keep the entry-status-unknown state for first-load failures so the screen cannot submit a join until status is verified.
