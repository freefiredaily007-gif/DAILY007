---
name: Expo native-module preview shims
description: Diagnose browser-preview build failures caused by Expo importing native React Native exports.
---

An isolated Vite preview can fail before rendering when Expo dependencies resolve native files instead of their `.web` siblings. Vite's dependency optimizer uses esbuild resolution separately from the normal Vite resolver, so setting only `resolve.extensions` may leave the optimizer selecting the native module.

**Why:** Expo dependency updates can change which modules are imported even when the app’s web-facing screens have not changed, and the optimizer may not follow Metro's platform-suffix resolution by default.

**How to apply:** In the isolated preview config, prioritize `.web` extensions in both `resolve.extensions` and `optimizeDeps.esbuildOptions.resolveExtensions`. Define Metro-style browser globals (`__DEV__`, `global`, and `process.env.EXPO_OS`) only in that preview when required. Prefer selecting Expo's web implementation over adding native-only exports to a React Native Web stub; keep app code and native dependencies unchanged.

The generic mockup artifact workflow is separate from the React Native Web regression harness. Opening a Home regression page through the generic workflow can resolve native React Native source and fail on Flow-only `import typeof`, even when the isolated regression checks pass.

**Why:** The generic artifact Vite config and the dedicated regression config use different module aliases and optimizer settings, so a failure in one does not establish a failure in the screen or its isolated tests.

**How to apply:** Run Home regression pages through the dedicated harness; only change the generic workflow if it is intentionally being made to support those React Native fixtures.
