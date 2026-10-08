---
name: Expo native-module preview shims
description: Diagnose browser-preview build failures caused by Expo importing native React Native exports.
---

An isolated Vite preview can fail before rendering when Expo dependencies resolve native files instead of their `.web` siblings. Vite's dependency optimizer uses esbuild resolution separately from the normal Vite resolver, so setting only `resolve.extensions` may leave the optimizer selecting the native module.

**Why:** Expo dependency updates can change which modules are imported even when the app’s web-facing screens have not changed, and the optimizer may not follow Metro's platform-suffix resolution by default.

**How to apply:** In the isolated preview config, prioritize `.web` extensions in both `resolve.extensions` and `optimizeDeps.esbuildOptions.resolveExtensions`. Define Metro-style browser globals (`__DEV__`, `global`, and `process.env.EXPO_OS`) only in that preview when required. Prefer selecting Expo's web implementation over adding native-only exports to a React Native Web stub; keep app code and native dependencies unchanged.
