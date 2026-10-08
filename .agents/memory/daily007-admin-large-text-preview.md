---
name: Admin large-text preview checks
description: Test enlarged Android text in the isolated React Native Web Admin preview without mistaking input scrolling for page overflow.
---

**Rule:** Measure a populated single-line input's outer bounds separately from its content scroll width. React Native Web inputs naturally scroll long values horizontally; that does not mean the field or page extends beyond the viewport. Render isolated Admin screens inside `AdminUiProvider` so preview buttons use the same minimum touch targets as the real Admin shell. At enlarged text sizes, let registration and payment status chips wrap; a single row can widen the parent scroll content and shift cards offscreen.

**Why:** Overlong fake room credentials made a correctly sized input look clipped in the browser check. Directly rendering an Admin screen without its provider uses the player button style and can report a false touch-target failure. The large-text API mock also substitutes long-name tournament fixtures above 1× scale, so recovery assertions must account for that fixture. At 320px and 1.5× text, unwrapped status chips expanded the React Native Web scroll content to 407px while the document remained 320px wide.

**How to apply:** Use realistic field values when checking the control itself; separately assert document, panel, tab, and non-input text bounds at the selected scale. Resolve `react-native-web` through the Daily007 dependency path when wiring the large-text mock, wrap isolated Admin screens in `AdminUiProvider`, and use the large-text fixture when checking loaded cards.
