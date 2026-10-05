---
name: Daily007 UI asset test isolation
description: How to regression-test selection logic that uses Metro-resolved static images.
---

Keep format and artwork selection in a platform-independent TypeScript helper that accepts its image sources as data. Let the React Native UI layer retain static Metro `require()` calls and pass those mappings into the helper. In Node tests, verify helper selection with identifiable values and separately assert that the UI maps each key to the intended static asset and supplies the maps to the helper.

**Why:** Node's test runner cannot load the React Native UI module and its static image requires the same way Metro does; importing the UI would make a focused logic test depend on the mobile bundler.

**How to apply:** Use this pattern for Daily007 selectors that need to be tested under Node while keeping images statically discoverable by Expo/Metro.