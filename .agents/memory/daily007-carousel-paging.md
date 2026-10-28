---
name: Daily007 Home carousel paging
description: Cross-platform page snapping in the native Home carousel and its React Native Web preview.
---

**Rule:** Use viewport-width page wrappers with `pagingEnabled` and derive scroll offsets and indicator positions from the viewport width. Do not rely on `snapToInterval` in React Native Web.

**Why:** React Native Web's `ScrollView` ignores `snapToInterval`. Full-width children provide compatible snap points for its CSS paging and native Android's viewport paging.

**How to apply:** When changing or testing the Home carousel, use the isolated preview with touch gestures and verify every card's bounds and active indicator at representative widths. Keep preview data mocked.

**Why:** In Android Maestro checks, a generic swipe and `scrollUntilVisible` did not advance the paged carousel; a deliberate horizontal gesture did.

**How to apply:** For native carousel tests, use a clear horizontal swipe across the carousel and assert the destination card instead of relying on `scrollUntilVisible` to page.
