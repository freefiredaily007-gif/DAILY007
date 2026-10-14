---
name: Daily007 Admin accessibility regression tests
description: Lessons for keeping Admin accessibility source-contract tests reliable as platform behavior evolves.
---

Source-contract assertions for Admin accessibility should account for platform-specific behavior and harmless TypeScript annotations. A stale exact pattern can fail even when the implementation still meets the intended accessibility contract.

**Why:** Existing assertions stopped matching after toast announcements became platform-specific and a loaded-user variable gained an explicit type, masking the separate rendered-tab test result.

**How to apply:** Prefer assertions that verify the relevant platform condition and accessible outcome while allowing formatting or type annotation changes.
