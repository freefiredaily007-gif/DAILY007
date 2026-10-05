---
name: Daily007 UI asset test isolation
description: How to test Metro-backed asset selectors in Node and real UI in Vite browser previews.
---

Keep format and artwork selection in a platform-independent TypeScript helper that accepts its image sources as data. Let the React Native UI layer retain static Metro `require()` calls and pass those mappings into the helper. In Node tests, verify helper selection with identifiable values and separately assert that the UI maps each key to the intended static asset and supplies the maps to the helper.

**Why:** Node's test runner cannot load the React Native UI module and its static image requires the same way Metro does; importing the UI would make a focused logic test depend on the mobile bundler.

**How to apply:** Use this pattern for Daily007 selectors that need to be tested under Node while keeping images statically discoverable by Expo/Metro.

When a Vite/React Native Web regression preview imports a real screen that also imports shared UI containing Metro `require()` asset calls, add a test-only `globalThis.require` shim before the app entry module loads. Return inert asset paths only when those assets are not rendered by the tested screen; leave production and Metro configuration unchanged.

**Why:** Vite does not apply Metro's static asset transform, so bare `require()` calls can fail during module initialization even when the screen under test never uses those images.

**How to apply:** Scope the shim to the isolated preview HTML. If the tested flow renders a required image, map that asset explicitly rather than returning an inert path.