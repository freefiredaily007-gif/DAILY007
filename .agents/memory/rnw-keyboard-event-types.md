---
name: React Native Web keyboard event types
description: The React Native public declaration gap around web-only key handlers.
---

**Rule:** In this workspace, React Native's public package types may omit `onKeyDown` on `View` and `Pressable` even though React Native Web forwards it and generated declarations include it. Keep web-only handlers narrowly typed and pass them through a spread prop object on a suitable container.

**Why:** Direct JSX event props failed Daily007's app typecheck because TypeScript resolved the public declarations rather than the generated declarations.

**How to apply:** For React Native Web keyboard behavior, check the package-root types, guard handling with `Platform.OS === "web"`, and verify both typecheck and browser focus behavior.
