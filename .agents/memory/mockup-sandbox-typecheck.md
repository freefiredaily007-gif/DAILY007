---
name: Mockup sandbox typecheck conflicts
description: Distinguish pre-existing duplicate React type-version errors in the mockup sandbox from errors in isolated browser-preview code.
---

The mockup sandbox typecheck can report React ref type incompatibilities in shared UI components even when an isolated Vite browser preview and its new test code run cleanly. The conflict comes from different React type versions arriving through workspace packages.

**Why:** A regression-preview typecheck surfaced errors only in unchanged sandbox UI components, not in the preview harness.

**How to apply:** When the sandbox typecheck fails, confirm whether the diagnostics are still limited to the existing cross-package React type conflict before attributing them to new preview code or expanding the task scope.

Keep the sandbox's `@types/react` and `@types/react-dom` on `~19.2.2`, matching the Expo app's React 19.2 type line. The shared catalog can resolve to 19.3 while imported Expo screens and optional peer declarations still use 19.2, making structurally equivalent React refs incompatible to TypeScript.

**Why:** The Admin browser preview imports real mobile screens into the sandbox, so both type lines can enter its dependency graph.

**How to apply:** If imported mobile code or its peer dependencies still resolve React types to 19.2, align the sandbox declarations to that range instead of weakening refs or suppressing type errors.

With pnpm, a linked dependency can resolve React declarations from a package-specific `node_modules` directory beside its virtual-store package, even when the app-level declarations agree.

**Why:** Checking only the direct `node_modules/@types` packages misses peer-context copies that imported preview code can resolve.

**How to apply:** When extending the mobile preview compatibility guard, inspect reachable package peer contexts and include both the owning dependency and declaration path in mismatch diagnostics.