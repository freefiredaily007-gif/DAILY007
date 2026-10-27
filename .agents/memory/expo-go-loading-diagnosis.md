---
name: Expo Go and CLI startup diagnosis
description: Distinguishing generic Expo Go failures and optional CLI tooling warnings from actual app startup failures.
---

Do not treat Expo Go's blue “Something went wrong” page as evidence that Google authentication or its callback is broken. It is a generic failure screen; the actual device error is under “View error log.”

Likewise, a React Native DevTools install warning about missing `libglib-2.0.so.0` is non-fatal when Metro still starts and prints the QR and Web URLs.

An Expo workflow restart can fail with `EADDRINUSE` while an earlier Metro process still serves `/status`. Check the listening process and port response before attempting another restart.

On headless GitHub Actions runs, Expo's first “Waiting on http://localhost” line can arrive only after a three-minute readiness deadline has expired. Repeated Android runner logs on 2026-10-27 showed the deadline was too short, not an observed Metro startup exception.

On a fresh Expo Go emulator, the native developer menu's “Continue” prompt may appear only after Metro finishes bundling and the JavaScript root mounts. An earlier tap after `openLink` can miss it even though the app route is loading behind the menu. The bundle-progress label may be visible in a screenshot but absent from Maestro's accessibility tree, so waiting for that text to disappear can return immediately.

**Why:** Android CI artifacts showed the app route behind both Expo Go's “Continue” menu and a “Pixel Launcher isn't responding” dialog. Logcat confirmed the JavaScript root had started without a matching runtime error, while Maestro could not access the covered fixture.

**How to apply:** Use bounded retries with an app-specific accessibility marker; conditionally tap Android's `android:id/aerr_wait` when the launcher ANR appears, then Expo Go's “Continue” prompt. Do not trust screenshot-only bundling text as a Maestro visibility condition.

**Why:** Repeated screenshots of the outer failure screen gave no exception details and led to speculative callback changes. A valid callback route alone does not establish that the project loaded correctly on the phone.

**Why:** A duplicate Expo start reported the occupied port even though a Metro process still responded with `packager-status:running`; workflow state alone did not show whether the phone preview was available.

**Why:** The Metro readiness timer can expire as Expo reaches its first listener startup output, making a slow cold start look like a network or application failure.

**How to apply:** Check Expo dependency alignment and Expo Doctor, then verify the Android manifest and launch bundle through the preview host. If the CLI reports the GLib warning but reaches Metro's QR/Web startup output, continue validating the app instead of treating the warning as a blocker. A successful bundle and web preview establish server/build health, not successful phone execution or native OAuth. Keep that distinction explicit and request the detailed device log if the phone still fails. For `EADDRINUSE`, inspect the port owner and `/status` response before retrying; do not infer server availability from the workflow status alone. For headless Android CI, compare process start time to Metro's first startup log before investigating networking, and allow a longer cold-start interval when logs show that Metro only reached its listen step at the deadline.