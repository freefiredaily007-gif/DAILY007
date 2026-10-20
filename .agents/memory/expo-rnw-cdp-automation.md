---
name: Expo React Native Web browser checks
description: CDP locator and value-assertion quirks for interactive Expo screens rendered through React Native Web.
---

**Rule:** Some React Native Web `Pressable` wrappers are focusable but do not expose `role="button"` when the component omits `accessibilityRole`. Normalize locale-formatted values before comparing them in browser assertions.

**Why:** In the Daily007 Admin UI, the Rewards navigation rendered as a `tabindex` element without a button role, and coin amounts used Indian thousands separators. Role-only selectors missed the navigation, and an unformatted string check missed a valid refresh.

**How to apply:** In isolated mobile-width CDP tests, inspect the rendered DOM, locate such controls through their visible text and focusable wrapper, and parse or format displayed values using the app's locale.

**Rule:** For nested React Native Web scroll areas, move the nearest scrollable ancestor directly before measuring whether an action is reachable; `scrollIntoView` alone may not scroll keyboard-aware forms far enough.

**Why:** In the 2× Wallet form preview, the recharge button remained below the viewport until the actual modal scroll container was advanced and the sheet was positioned within the visible area.

**How to apply:** Find the nearest ancestor whose vertical overflow is scrollable and whose content exceeds its viewport, adjust that element's `scrollTop`, then compare the action's bounds with the visible viewport.

**Rule:** Large-text layout checks should compare text bounds with their own card bounds and check neighboring cards for overlap; document overflow alone can miss both.

**Why:** In the Daily007 2× preview, the screen root clipped horizontal overflow while podium text still escaped its card and overlapped adjacent entries.

**How to apply:** For scaled or expanded React Native Web content, assert child text remains within its card, cards remain separated, and the last result can be scrolled into the viewport.

**Rule:** A control taller than the available viewport cannot be fully scrolled into view; verify that a usable tap area remains visible instead of requiring the full control bounds to fit.

**Why:** At narrow widths and 2× text, a video card can become taller than the screen while remaining actionable through its visible portion.

**How to apply:** After scrolling the nearest scroll container, require at least a 44px visible touch area in each dimension for oversized controls, while still requiring smaller controls to fit fully.

**Rule:** React Native Web does not faithfully expose native `View` grouping through `accessible`, and `accessibilityRole="text"` maps to no web role. For grouped native text, verify the rendered label content and the source-level grouping props rather than requiring a browser role or tab stop.

**Why:** A Wallet refund preview rendered its `aria-label`, but the web DOM omitted role and focus attributes even though the native component received `accessible` and `accessibilityRole`. Adding web-only focus props to satisfy that preview could change native behavior.

**How to apply:** Keep React Native's native accessibility props for TalkBack, test their label content in the isolated RNW preview, and confirm actual TalkBack behavior separately when an Android device is available.

**Rule:** React Native Web may omit native `accessibilityState.selected` from rendered tab ARIA attributes. For web tablists that require browser-selected semantics, pass explicit `aria-selected` alongside the native state.

**Why:** A Daily007 leaderboard browser check showed that a tab's native selected state alone did not produce `aria-selected`, so browser users could not inspect which tab was selected.

**How to apply:** Keep `accessibilityState.selected` for native platforms and add `aria-selected` when browser tab semantics need it. Confirm native screen-reader behavior separately.

**Rule:** React Native Web `Pressable` may omit native `accessibilityState.busy` from `aria-busy`, and setting `disabled` removes its browser focusability. A loading button may replace its title with a spinner, so assert the separate progress message, accessible label, and disabled state rather than button text.

**Why:** The Admin Retry preview rendered progress without `aria-busy` and hid the loading button's title while its spinner was shown; Google signup also lost keyboard focus when `Pressable` became disabled during its held request.

**How to apply:** Pair `accessibilityState` with explicit `aria-busy` for web previews. When pending must preserve focus, keep `disabled` false and ignore presses in the handler; verify native screen-reader speech separately.

**Rule:** For a tall list card, scroll each action into the nearest overflowing scroll container before hit-testing; centering the whole card may still leave its bottom actions off-screen.

**Why:** At 1.5× text, long wallet and user identity cards exceeded the phone viewport, so moving the card as a whole did not make its actions reachable.

**How to apply:** Find the nearest ancestor with vertical `auto`/`scroll` overflow and excess content height, position the action itself within that viewport, then verify its center hit-test and rendered label.

**Rule:** When the isolated Home preview emits repeated identical React Native Web text-node errors on initial render, baseline error signatures before testing a later refresh.

**Why:** Requiring zero console errors can fail a refresh test on warnings already emitted by the Home preview; signature comparison still catches new error types.

**How to apply:** After Home's initial cards and polling callback are ready, capture the current browser-error strings in a `Set`. After the refresh, fail only for error signatures not present in that baseline.

**Rule:** Do not return DOM elements through a CDP evaluation configured to return by value; keep node references in the page and return a primitive.

**Why:** Returning a live-region node exceeded CDP's serializable-object chain limit and stopped the browser test before its assertions.

**How to apply:** Wrap page-side node assignment in a function that returns `true`, then compare the stored node in later boolean evaluations.

**Rule:** On React Native Web, `Animated.createAnimatedComponent(Pressable)` can drop a Pressable `style` callback, leaving the control at intrinsic size. For controls needing custom layout, use an opt-in static style array and explicit pressed state.

**Why:** A DAILY007 auth button stayed at its text height when its 56px style was returned from the animated Pressable callback; the static style path produced the intended tap target.

**How to apply:** Keep the static-style path opt-in so other buttons retain their existing behavior, and verify the target's rendered bounds in Chromium.