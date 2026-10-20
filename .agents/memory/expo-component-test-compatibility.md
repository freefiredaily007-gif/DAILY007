---
name: Expo component test compatibility
description: Avoid React renderer version mismatches in Expo workspace component tests.
---

The root `react-test-renderer` package was version 18.3.1 while Daily007 uses React 19.2.3; bundling them together failed at runtime with an undefined `ReactCurrentBatchConfig`.

**Why:** A root-level renderer can resolve successfully while still being incompatible with the app's React version, so the failure looks like a broken component test rather than a peer-version mismatch.

**How to apply:** Check the renderer's React peer compatibility before adding component-renderer tests. Prefer a matching renderer or test the isolated async state helper and assert its UI bindings when a compatible renderer is unavailable.
