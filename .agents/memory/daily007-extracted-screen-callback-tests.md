---
name: Extracted screen callback tests
description: Running React Native screen callbacks directly in Node without rendering the whole application.
---

When transpiling a component callback out of its module, inject every referenced module-level helper, constant, and mutable ref into the callback scope. A missing dependency can make the callback's real async load fail and be caught as an ordinary screen error, leaving the test fixture with empty data. If a refactor splits request logic from a trigger wrapper, extract and compose both callbacks so the test retains the real dependency chain. If a focus callback starts an asynchronous load without returning it, await an explicit signal from the load's completion path rather than awaiting the focus callback.

**Why:** Extracted callbacks do not retain their module scope, refactored wrappers may reference sibling callbacks, and navigation focus callbacks commonly fire-and-forget data loads. A missing ref/helper can be hidden by the screen's own error handling, making downstream timer or state assertions fail far from the true cause.

**How to apply:** Use this for focused Node tests of screen refresh behavior when a full native renderer is unnecessary; inject the real callback dependencies and preserve wrapper composition, assert the initial load succeeded before testing downstream behavior, then resolve the test wait from its loading-state completion.
