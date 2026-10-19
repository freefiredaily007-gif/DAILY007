---
name: Daily007 tournament refresh coalescing
description: Keep manual pulls from duplicating an in-flight app-resume, connectivity, or scheduled tournament refresh.
---

Manual pulls should join any in-flight tournament-list load instead of starting a competing request. Focus transitions are allowed to start a fresh request so returning to the screen can load current data; the latest-request guard prevents an older response from replacing it.

**Why:** A pull made during an app-resume refresh should display that shared request's failure once, preserve the existing card, and remain able to retry with a fresh request afterward.

**How to apply:** Keep load coalescing and the latest-request guard aligned. Cover app-resume + manual-pull success, shared failure, and a later successful manual retry in the browser regression; use a device check for native lifecycle and gesture behavior.
