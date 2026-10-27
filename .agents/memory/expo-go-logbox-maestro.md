---
name: Expo Go LogBox in Android Maestro flows
description: Diagnose lower form taps that open Expo Go warning details during Android emulator tests.
---

When a Maestro flow running through Expo Go opens a “Log N of M” warning screen after tapping a form field, the visible LogBox may be taking the touch even when Maestro's hierarchy still identifies the underlying native input. Center lower form fields and buttons in the viewport before tapping them, then inspect the captured screen if the next selector disappears.

Opening the same Expo Router fixture URL in a new Maestro flow may preserve its mounted React state. Explicitly select a reset scenario at the start of each flow instead of assuming `openLink` remounts the fixture. On Home tests, wait for the asynchronous carousel container before searching for one of its cards, and avoid scrolling away from the expected top position.

**Why:** Android CI showed the player-name field near the bottom of the viewport, followed by a full-screen Expo warning detail instead of the next form control. The accessibility hierarchy can describe an element underneath a native overlay.

**How to apply:** In Expo Go emulator flows, reset fixture state explicitly between same-route flows, wait for async fixture data, and scroll/center form inputs before tapping—especially when warning toasts or LogBox notices are present. Treat a missing follow-up selector as a possible overlay or lifecycle issue, not automatically as a missing app field.
