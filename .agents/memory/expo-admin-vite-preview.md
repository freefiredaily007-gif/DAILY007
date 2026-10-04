---
name: Expo Admin browser preview
description: Safely preview authenticated Expo Admin screens in an isolated browser without changing app authentication.
---

For narrow-screen checks of authenticated Expo Admin screens, import the real screen into a temporary Vite preview with a fake Admin identity and controlled API responses. Provide `react-native-web` and lightweight stubs for native-only modules. Metro-style asset `require` calls can run during module initialization, so define a harmless global `require` before dynamically importing the screen; a static import runs too early.

**Why:** The capture browser cannot sign into the app, while Vite does not supply Metro's asset loader or Expo native modules. A separate fake-data preview checks the real layout without weakening authentication or touching live data.

**How to apply:** Keep preview data and native shims isolated from app code, use dynamic import after installing the `require` shim, then remove temporary routes, aliases, stubs, and generated preview entries when the visual check is complete.

If Vite/React Native Web begins failing on changing package-export errors in native or style dependencies after isolated shims are added, treat that as preview-tooling incompatibility rather than an app defect. Stop adding aliases, source-review the screens that could not render, and clearly note which screens were not visually verified.

**Why:** React Native Web's transitive Expo and style packages can fail under Vite's dependency optimizer even while the Expo/Metro app workflow starts normally.

**How to apply:** Keep these shims temporary; do not change application dependencies or production code just to silence a browser-preview-only error.