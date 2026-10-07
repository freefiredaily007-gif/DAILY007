---
name: Daily007 scheduled-start boundary tests
description: Testing date-boundary lifecycle transitions when the UI schedules real timers from tournament instants.
---

When testing fixed calendar boundaries with a mocked `Date.now`, exercise month-end and New Year cases in separate fixtures with nearby start times. Do not jump a fake clock across months while relying on a real scheduled timeout to fire.

**Why:** The application schedules a real timeout from the next tournament instant. Moving the mocked clock does not wake a timeout that was scheduled for a distant future instant.

**How to apply:** Keep each fixed boundary's lifecycle transitions seconds apart, verify the exact serialized start instant, and reload the fixture for another calendar boundary.
