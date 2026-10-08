---
name: Daily007 tournament calendar consistency
description: Cross-screen rule for tournament start dates and lifecycle transitions
---

Show scheduled tournament dates and times in IST regardless of browser timezone, but compute lifecycle from the canonical start instant.

**Why:** A New Year boundary must remain the same moment across Home, My Matches, and Tournament Details. Relying on persisted status alone left Tournament Details showing Upcoming after the start.

**How to apply:** Use the shared IST schedule formatter for visible start values and the shared lifecycle calculation for transitions. Test timestamps on both sides of a boundary in IST and a non-IST timezone.
