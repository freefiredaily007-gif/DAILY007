---
name: Extracted screen callback tests
description: Running React Native screen callbacks directly in Node without rendering the whole application.
---

When transpiling a component callback out of its module, inject every referenced module-level constant and helper into the callback scope. If a refactor splits request logic from a trigger wrapper, extract and compose both callbacks so the test retains the real dependency chain. If a focus callback starts an asynchronous load without returning it, await an explicit signal from the load's completion path rather than awaiting the focus callback.

**Why:** Extracted callbacks do not retain their module scope, refactored wrappers may reference sibling callbacks, and navigation focus callbacks commonly fire-and-forget data loads.

**How to apply:** Use this for focused Node tests of screen refresh behavior when a full native renderer is unnecessary; inject the real callback dependencies and preserve wrapper composition, then resolve the test wait from its loading-state completion.
