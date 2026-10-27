---
name: Expo Go and CLI startup diagnosis
description: Distinguishing generic Expo Go failures and optional CLI tooling warnings from actual app startup failures.
---

Do not treat Expo Go's blue “Something went wrong” page as evidence that Google authentication or its callback is broken. It is a generic failure screen; the actual device error is under “View error log.”

Likewise, a React Native DevTools install warning about missing `libglib-2.0.so.0` is non-fatal when Metro still starts and prints the QR and Web URLs.

An Expo workflow restart can fail with `EADDRINUSE` while an earlier Metro process still serves `/status`. Check the listening process and port response before attempting another restart.

On headless GitHub Actions runs, Expo's first “Waiting on http://localhost” line can arrive only after a three-minute readiness deadline has expired. Repeated Android runner logs on 2026-10-27 showed the deadline was too short, not an observed Metro startup exception.

On a fresh Expo Go emulator, a native startup prompt may appear only after Metro finishes bundling and the JavaScript root mounts. The bundle-progress label may be visible in a screenshot but absent from Maestro's accessibility tree, so waiting for that text to disappear can return immediately. Dismissing the prompt may reveal Expo Go's full developer menu, whose close control has no accessibility label; Android Back dismisses it. A slow headless emulator can also display a background Pixel Launcher ANR dialog over the app; disable background ANR dialogs for the test emulator and verify the setting before launching the app. If the Pixel Launcher ANR still appears, close it only when its title is explicitly visible, then dismiss Expo Go's developer menu.

**Why:** Android CI artifacts showed the app route behind a “Pixel Launcher isn't responding” dialog caused by `com.google.android.apps.nexuslauncher`, as well as Expo Go's full developer menu. The route loaded without a matching runtime error, but Maestro could not access the covered fixture while the system ANR dialog remained. A later CI run displayed the launcher dialog even though `anr_show_background` was verified as `0`; the Expo Go “Continue” prompt can be followed by a developer-menu overlay.

**How to apply:** Set and verify `settings put global anr_show_background 0` on headless emulator jobs. Use bounded retries until an app-specific accessibility marker is visible; if the exact Pixel Launcher ANR title appears, tap its `android:id/aerr_close` control, then press Android Back when Expo Go's “Open React Native dev menu” item is visible. Keep the “Continue” and “Reload” prompt handlers as separate fallbacks. Do not trust screenshot-only bundling text as a Maestro visibility condition.

**Why:** Repeated screenshots of the outer failure screen gave no exception details and led to speculative callback changes. A valid callback route alone does not establish that the project loaded correctly on the phone.

**Why:** A duplicate Expo start reported the occupied port even though a Metro process still responded with `packager-status:running`; workflow state alone did not show whether the phone preview was available.

**Why:** The Metro readiness timer can expire as Expo reaches its first listener startup output, making a slow cold start look like a network or application failure.

**How to apply:** Check Expo dependency alignment and Expo Doctor, then verify the Android manifest and launch bundle through the preview host. If the CLI reports the GLib warning but reaches Metro's QR/Web startup output, continue validating the app instead of treating the warning as a blocker. A successful bundle and web preview establish server/build health, not successful phone execution or native OAuth. Keep that distinction explicit and request the detailed device log if the phone still fails. For `EADDRINUSE`, inspect the port owner and `/status` response before retrying; do not infer server availability from the workflow status alone. For headless Android CI, compare process start time to Metro's first startup log before investigating networking, and allow a longer cold-start interval when logs show that Metro only reached its listen step at the deadline.