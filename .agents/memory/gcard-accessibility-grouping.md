---
name: GCard accessibility grouping
description: When a labeled interactive card should be one screen-reader stop, group its decorative contents without changing every GCard.
---

Use opt-in accessibility grouping for interactive cards whose child content is fully represented by one accessibility label. Keep the card action exposed as a single button and hide only the inner decorative subtree from screen-reader traversal.

**Why:** `GCard` is shared by cards with different content and navigation semantics. Globally hiding descendants could remove useful or interactive content from other cards.

**How to apply:** Enable grouping only when the accessible label covers all meaningful card information and there are no nested actions.
