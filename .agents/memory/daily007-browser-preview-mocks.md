---
name: Daily007 browser preview mocks
description: Vite dependency scanning and mock completeness across Daily007 browser preview routes.
---

When a Daily007 browser preview imports multiple screens, keep its local mock exports aligned with every reachable screen, not only the screen selected by the current URL. Vite's dependency scan follows the import graph and checks named exports in off-route modules too.

**Why:** A Home-only preview failed dependency scanning because the screen registry also reached Video.tsx, whose generated query-key helper was missing from the local mock. The signup preview likewise exposed an omitted persistence-error class in its Auth API mock.

**How to apply:** After changing imports used by previewed screens, run the browser-entrypoint smoke test across all specialized Vite configs and add only isolated local stubs for the missing exports.
