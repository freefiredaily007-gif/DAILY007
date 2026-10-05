---
name: Daily007 tournament detail returns
description: Preserve the originating filtered tournament list when opening a detail route.
---

**Rule:** Open tournament details from a filtered list with a stack push so Android Back returns to that exact list instance and its route parameters.

**Why:** React Navigation's `navigate` can focus or reuse an existing route with the same name, which may not leave the current list as the next screen in the back stack.

**How to apply:** Use `push` for list-originated tournament details when the source list must remain directly behind the detail screen. Keep `navigate` where route reuse is intended.