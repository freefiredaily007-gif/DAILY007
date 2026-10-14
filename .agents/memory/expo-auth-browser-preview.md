---
name: Expo auth browser previews
description: Requirements for rendering Daily007's Expo auth screen in an isolated Vite browser test.
---

An isolated Vite preview of the Expo auth screen must define `__DEV__` and replace `expo-router` with a local shim before browser assertions can reach the screen. Keep those compatibility shims in the preview config, not in production auth code.

**Why:** Without the Expo dev global the auth screen crashes at render; resolving Expo Router directly also pulls native dependencies into the browser preview. These setup failures can look like signup regressions even when the actual UI issue is separate.

**How to apply:** When a Daily007 auth browser check fails before its field assertions, verify its `__DEV__` define and `expo-router` alias first. Once it renders, treat later selector or behavior failures as app/test-contract issues and inspect them separately.
