---
name: Daily007 browser preview mocks
description: Vite dependency scanning and mock completeness across Daily007 browser preview routes.
---

When a Daily007 browser preview imports multiple screens, keep its local mock exports aligned with every reachable screen, not only the screen selected by the current URL. Vite's dependency scan follows the import graph and checks named exports in off-route modules too.

**Why:** A Home-only preview failed dependency scanning because the screen registry also reached Video.tsx, whose generated query-key helper was missing from the local mock. The signup preview likewise exposed an omitted persistence-error class in its Auth API mock.

**How to apply:** Run the full browser-entrypoint smoke after adding a route; shared screen bundles statically import off-route modules, and earlier previews can expose missing named exports or Metro globals. Fix these with local Vite defines and stubs only, not app-code changes.

For phone-width layout assertions, use explicit active-content markers rather than every test ID in the DOM; inactive navigation tabs can be mounted but intentionally hidden.

**Why:** A hidden Admin tab was present in the preview markup but was not part of the visible phone layout, so treating every marker as visible produced a false failure.

**How to apply:** Keep render-presence markers separate from the subset whose bounding boxes must remain visible at the emulated phone width.

When offscreen background decoration expands the document, clip only that decorative layer instead of the scrollable screen.

**Why:** Clipping the whole screen can cut off interactive content or its shadows, while a dedicated background layer prevents horizontal overflow without changing form scrolling.

**How to apply:** Put absolute decorative shapes in an absolute-fill wrapper with overflow hidden, and keep content outside that wrapper.
