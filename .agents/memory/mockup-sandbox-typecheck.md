---
name: Mockup sandbox typecheck conflicts
description: Distinguish pre-existing duplicate React type-version errors in the mockup sandbox from errors in isolated browser-preview code.
---

The mockup sandbox typecheck can report React ref type incompatibilities in shared UI components even when an isolated Vite browser preview and its new test code run cleanly. The conflict comes from different React type versions arriving through workspace packages.

**Why:** A regression-preview typecheck surfaced errors only in unchanged sandbox UI components, not in the preview harness.

**How to apply:** When the sandbox typecheck fails, confirm whether the diagnostics are still limited to the existing cross-package React type conflict before attributing them to new preview code or expanding the task scope.