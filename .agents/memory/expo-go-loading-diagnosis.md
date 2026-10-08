---
name: Expo Go and CLI startup diagnosis
description: Distinguishing generic Expo Go failures and optional CLI tooling warnings from actual app startup failures.
---

Do not treat Expo Go's blue “Something went wrong” page as evidence that Google authentication or its callback is broken. It is a generic failure screen; the actual device error is under “View error log.”

Likewise, a React Native DevTools install warning about missing `libglib-2.0.so.0` is non-fatal when Metro still starts and prints the QR and Web URLs.

**Why:** Repeated screenshots of the outer failure screen gave no exception details and led to speculative callback changes. A valid callback route alone does not establish that the project loaded correctly on the phone.

**How to apply:** Check Expo dependency alignment and Expo Doctor, then verify the Android manifest and launch bundle through the preview host. If the CLI reports the GLib warning but reaches Metro's QR/Web startup output, continue validating the app instead of treating the warning as a blocker. A successful bundle and web preview establish server/build health, not successful phone execution or native OAuth. Keep that distinction explicit and request the detailed device log if the phone still fails.