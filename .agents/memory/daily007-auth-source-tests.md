---
name: Daily007 Auth layout source tests
description: Keep responsive login source assertions aligned with semantic behavior during layout refactors.
---

When asserting Auth layout behavior from source, check the responsive conditions and required style modifiers without binding the test to a specific derived-constant name or requiring one modifier to own all spacing.

**Why:** The login layout kept the same compact behavior after its breakpoint was extracted into a shared condition and spacing moved into a shared modifier, but exact source regexes went stale.

**How to apply:** Inspect the current Auth component first, then assert the relationship between the responsive breakpoint and login-only styles plus the required layout properties; run the focused regression suite.
