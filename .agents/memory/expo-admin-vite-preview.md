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

For navigation regressions where React Native or Expo dependencies prevent the real screens from rendering in Vite, a Node test can execute the app's TypeScript route handler and data loader with the installed React Navigation routers. Treat `CommonActions.goBack()` as the router-level Android Back action, and state that neither the rendered screen nor the native BackHandler was exercised.

**Why:** The actual router transitions and route-specific data can still be tested without widening the preview shims, but that does not verify native event registration or the visible screen.

**How to apply:** Isolate API fixtures, run the real route handler and loader extracted from source, assert the nested tab and detail route state before and after Back, and keep the native/UI limitation explicit.

For React Native Web checks that shrink the viewport to simulate an open keyboard, make the preview page and `#root` a height-constrained flex column. A block-only root can leave `flex: 1` screen content at its natural content height, making keyboard resize and dismissal checks misleading.

**Why:** React Native Web needs the screen's parent to participate in flex layout before a viewport resize behaves like the native app's available-height change.

**How to apply:** Put any preview-only header outside `#root`, keep `min-height: 0`, and make `#root` a flex column before testing scroll-container dimensions across keyboard-open and restored viewport sizes.

**Rule:** Scope Vite dependency scanning to the active preview page when its aliases use focused test stubs; verify emulated CSS viewport dimensions only after navigating to a document with its viewport meta tag.

**Why:** The sandbox contains multiple independent HTML previews, so default scanning can evaluate unrelated screens against narrow mocks. Before navigation, Chromium's mobile layout viewport may not match the emulated device dimensions.

**How to apply:** Set `optimizeDeps.entries` to the single preview entry, apply device metrics before navigation, then assert `innerWidth` and `innerHeight` after the page loads.

**Rule:** The isolated Admin API-client mock must export hooks imported by every tab in `AdminApp`, including tabs not selected by the preview.

**Why:** `AdminApp` statically imports its screens, so one missing named hook prevents the whole preview from rendering before a tab is selected.

**How to apply:** When an Admin screen adds a generated API hook, add a no-network query or mutation stub to the mock API client used by the Admin preview.

**Rule:** In isolated React Native Web Android previews, prefer visible button text to locate and activate `Pressable` actions when accessibility or test selectors do not resolve.

**Why:** An action can render visibly while its expected selector is not available to the browser-driven test, making the test fail on the harness rather than on the screen behavior.

**How to apply:** Assert the action's rendered label and click the corresponding button node in preview tests; keep selectors for controls only when the DOM exposes them reliably.