---
name: React Native Web radio state
description: Accessible selected-state handling for radio Pressables in React Native Web and native layouts.
---

Keep `accessibilityState` on radio Pressables for native semantics, and also set explicit `aria-checked` for React Native Web. A Chromium check showed the role and accessible label rendered without a checked state when relying on `accessibilityState` alone.

**Why:** Screen readers need the selected radio option exposed in browser accessibility trees, and the native state alone was not reflected in the rendered web DOM.

**How to apply:** When adding a React Native radio group, verify both native `accessibilityState` and the web DOM’s `aria-checked` value.
