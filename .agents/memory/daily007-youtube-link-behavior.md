---
name: Daily007 YouTube link behavior
description: Product preference for the explicit YouTube action, in-app playback, and catalog search retention.
---

The catalog card opens the embedded player in Daily007. On Android, only the explicit “Open on YouTube” action should try to open the selected video in the YouTube app, with the saved browser URL as fallback. Returning to Daily007 must preserve the catalog search.

**Why:** The user tested browser-first behavior and chose app-first playback for the explicit link, while keeping catalog selection in-app.

**How to apply:** Keep external navigation separate from catalog-card taps; do not clear or reset the search when the external app is opened or when the user returns.
