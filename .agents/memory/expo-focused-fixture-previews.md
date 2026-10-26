---
name: Expo focus-aware fixture previews
description: Navigation context for focus-aware components in standalone Expo fixture routes.
---

**Rule:** When a standalone Expo fixture route is previewed through React Native Web, provide a minimal `NavigationContext` only around focus-aware components that call `useFocusEffect`. Keep real application screens on their normal navigation stack.

**Why:** A standalone tournament fixture route could render the real room-credentials panel only after it received a focus context; wrapping the route in an independent nested navigator left the browser preview blank. The fixture checks layout, not focus transitions.

**How to apply:** For preview-only fixture routes, supply a focused navigation stub with no-op listeners around the focus-aware child, and keep native focus behavior verified through its actual screen flows.
