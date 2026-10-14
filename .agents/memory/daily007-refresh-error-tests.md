---
name: Daily007 refresh error test fixtures
description: Keep controlled refresh failures aligned with their visible and announced error assertions.
---

For rendered failure/retry tests, keep the fixture's injected error message and expected accessible label or announcement in sync; stale default-message assertions can block later regression checks.

**Why:** A stale expectation stopped the refresh test before its selected-tab assertions, even though the UI correctly displayed the message configured by the held request.

**How to apply:** When a mock overrides a request failure, trace that exact value through visible text and announcement expectations before interpreting the test as a product defect.
