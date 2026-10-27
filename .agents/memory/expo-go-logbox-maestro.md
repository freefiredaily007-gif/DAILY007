---
name: Expo Go LogBox in Android Maestro flows
description: Diagnose lower form taps that open Expo Go warning details during Android emulator tests.
---

When a Maestro flow running through Expo Go opens a “Log N of M” warning screen after tapping a form field, the visible LogBox may be taking the touch even when Maestro's hierarchy still identifies the underlying native input. Center lower form fields and buttons in the viewport before tapping them, then inspect the captured screen if the next selector disappears.

**Why:** Android CI showed the player-name field near the bottom of the viewport, followed by a full-screen Expo warning detail instead of the next form control. The accessibility hierarchy can describe an element underneath a native overlay.

**How to apply:** In Expo Go emulator flows, scroll and center form inputs before tapping—especially when warning toasts or LogBox notices are present. Treat a missing follow-up selector as a possible overlay collision, not automatically as a missing app field.
