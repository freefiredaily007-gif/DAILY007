---
name: Admin large-text preview checks
description: Test enlarged Android text in the isolated React Native Web Admin preview without mistaking input scrolling for page overflow.
---

**Rule:** Measure a populated single-line input's outer bounds separately from its content scroll width. React Native Web inputs naturally scroll long values horizontally; that does not mean the field or page extends beyond the viewport.

**Why:** Overlong fake room credentials made a correctly sized input look clipped in the browser check. The isolated preview also needs an explicit alias to the Daily007-installed `react-native-web` package because the sandbox cannot resolve that package by its bare name.

**How to apply:** Use realistic field values when checking the control itself; separately assert document, panel, tab, and non-input text bounds at the selected scale. Resolve `react-native-web` through the Daily007 dependency path when wiring the large-text mock.
