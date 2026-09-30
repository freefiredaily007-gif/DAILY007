---
name: Legacy native navigation in Expo Router
description: Why the original React Navigation tree remains isolated inside the Expo Router entry.
---

Keep the original navigation tree isolated from Expo Router's root navigator when preserving exact legacy screen behavior is more important than converting every destination to file routes.

**Why:** Expo Router SDK 56+ rejects imports from React Navigation's native stack during bundling even if the navigator is isolated. A deliberate build-time opt-out is required; without an independent navigation tree, the nested container conflicts with Router's container. Rewriting the screen tree would risk losing role-specific destinations and navigation params.

**How to apply:** For future work touching this migration, verify both the Expo Router bundler opt-out and the independent navigation wrapper remain in place until navigation is intentionally migrated end-to-end. Do not use the old native iOS/Android projects as if they were generated for the current Expo SDK.