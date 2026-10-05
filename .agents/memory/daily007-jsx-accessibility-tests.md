---
name: Daily007 JSX accessibility source tests
description: Avoid fragile source slicing when checking Pressable controls and nested expanded JSX.
---

When a lightweight accessibility test reads JSX source, delimit a `Pressable` by its matching closing tag rather than the first `>`; arrow-function handlers contain `>`. For nested conditional content, locate the target row mapping before finding the enclosing branch boundary.

**Why:** A simple delimiter search truncated the control at `onPress={() =>`, and a nested `largeText` ternary made the first `) : null}` belong to the wrong branch.

**How to apply:** Prefer a real renderer when available; for focused source assertions, anchor on stable `testID` and mapped child expressions, and account for nested JSX conditionals.