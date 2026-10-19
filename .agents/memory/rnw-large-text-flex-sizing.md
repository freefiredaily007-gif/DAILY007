---
name: React Native Web large-text flex sizing
description: Avoids large-text content collapsing inside React Native Web flex columns.
---

For content-driven columns that must expand to fit enlarged text, `flex: 0` is not enough: React Native Web can emit `flex: 0 1 0%`, allowing the column to shrink while its children overflow or get clipped. Set `flexGrow: 0`, `flexShrink: 0`, and `flexBasis: 'auto'` when the column must preserve its intrinsic height.

**Why:** At 2× text scale, Home mode-card bodies collapsed to a few pixels in the browser preview, leaving labels outside a non-scrollable `overflow: hidden` card.

**How to apply:** When testing large text in RNW, inspect computed flex sizing and element bounds before treating a vertical clipping report as a scroll false positive.
