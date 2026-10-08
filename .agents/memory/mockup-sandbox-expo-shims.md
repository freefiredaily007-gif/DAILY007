---
name: Expo native-module preview shims
description: Diagnose browser-preview build failures caused by Expo importing native React Native exports.
---

An isolated Vite preview can fail before rendering when an Expo dependency starts importing a native React Native export that the browser-preview stub does not provide. This is a preview dependency-compatibility failure, not evidence of a screen layout or interaction bug.

**Why:** Expo dependency updates can change which native APIs are imported even when the app’s web-facing screens have not changed.

**How to apply:** For pre-render Vite import errors, compare the newly required exports with the preview’s React Native stub and fix only the preview compatibility boundary; do not alter player-facing UI to work around a bundler failure.
