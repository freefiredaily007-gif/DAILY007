---
name: Daily007 player format choices
description: The player-facing Clash Squad and Lone Wolf format selector must not offer 3 VS 3.
---

Player-facing Clash Squad and Lone Wolf format selectors show 1 VS 1, 2 VS 2, and 4 VS 4 only. Existing API/database support or records for other formats should not be removed just to hide an option from players.

**Why:** The user explicitly asked to remove 3 VS 3 from the format-selection screen after an earlier request included it.

**How to apply:** Keep the visible player format list separate from backend-supported values; preserve existing data and admin behavior unless the user asks otherwise.
