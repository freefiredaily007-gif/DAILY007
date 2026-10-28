---
name: Expo Go LogBox in Android Maestro flows
description: Diagnose lower form taps that open Expo Go warning details during Android emulator tests.
---

When a Maestro flow running through Expo Go opens a “Log N of M” warning screen after tapping a form field, the visible LogBox may be taking the touch even when Maestro's hierarchy still identifies the underlying native input. Center lower form fields and buttons in the viewport before tapping them, then inspect the captured screen if the next selector disappears. Warning toasts can also cover a pagination button’s center: Maestro may report the tap completed while the app never receives it, so use `centerElement: true` before each tap.

Opening the same Expo Router fixture URL in a new Maestro flow may preserve its mounted React state. Explicitly select a reset scenario at the start of each flow instead of assuming `openLink` remounts the fixture. On Home tests, wait for the asynchronous carousel container before searching for one of its cards, and avoid scrolling away from the expected top position. After navigating back from a non-first carousel card, assert that the same card remains selected and visible; the earlier card is offscreen until swiping back. Avoid running a whole flow directory when one test requires custom system settings; run that flow only through its setup runner.

When Android CI launches Expo Go's main activity after the project was backgrounded, Expo Go can show its project-history screen instead of restoring the running project. Reopen the exact Expo Router fixture deep link before asserting its state.

**Why:** `monkey -p host.exp.exponent 1` brought Expo Go to its home screen, so a resume assertion ran against the launcher rather than the fixture.

**How to apply:** After bringing Expo Go forward from its launcher, use Maestro `openLink` with the intended `EXPO_DEV_URL/--/...` fixture route, then wait for the fixture's test ID.

**Why:** Android CI showed the player-name field near the bottom of the viewport, followed by a full-screen Expo warning detail instead of the next form control. The accessibility hierarchy can describe an element underneath a native overlay. Wallet pagination confirmed that a persistent Require-cycle warning toast can intercept a footer button tap; `centerElement` alone cannot center a footer at the very end of a scroll view unless the test content has trailing scroll space. A 2× Home mode flow also tapped through the same LogBox warning into its detail screen until the card was centered. Another run showed the Android `aerr_wait` dialog can appear after an immediate startup-recovery loop has already finished, even when background ANR dialogs are disabled. A 2× Wallet fixture remained on empty history with its recharge control disabled despite mock settings and a wait, and its flow targeted a stale transaction-field selector. A later emulator setup failure hung in supplemental diagnostics because ADB probes can wait indefinitely when the emulator never boots. The Home carousel can also advance between a fixture-card lookup and tap, opening a different match; after disabling autoplay, a test still incorrectly expected an offscreen first card after returning from the second. Directory-based Maestro runs also included a 1.5× flow before its dedicated runner changed the emulator settings.

**How to apply:** In Expo Go emulator flows, reset fixture state explicitly between same-route flows, wait for async fixture data, and disable carousel autoplay in fixtures that assert a specific card. Assert the card selected before opening details after Back returns. Keep system-setting-dependent flows out of generic directory runs; invoke them through runners that apply, verify, and restore the device setting. Wait for `android:id/aerr_wait` when recovery needs to handle a delayed ANR dialog. Use per-fixture API injection rather than mutating shared API methods; seed test-only initial settings when a visual flow must open a gated form immediately, wait until the action is enabled, and assert the current form field selectors. Put a short timeout around each supplemental emulator/ADB probe so setup diagnostics cannot outlive the original failure. Use `centerElement: true` for bottom-placed inputs, buttons, and mode cards before tapping, especially when warning toasts or LogBox notices are present; add test-only trailing scroll space when a footer cannot otherwise be centered. Treat a missing follow-up selector as a possible overlay or lifecycle issue, not automatically as a missing app field.

## Cold starts after splitting emulator sessions

The first Maestro fixture in each fresh Android emulator session must handle Expo Go startup prompts and allow up to 60 seconds for its fixture ID to appear; a short wait can fail on the native splash even after Metro has bundled the app.

**Why:** The wallet session's host Metro reported `Android Bundled`, but the first route remained on Expo Go's native splash beyond a 15-second fixture wait. The core session passed because its first flow already handled startup prompts and waited longer.

**How to apply:** Add the prompt-recovery loop and a 60-second fixture wait to the first app-opening flow in every separately booted emulator session. Check the screenshot and fixture ID, not Metro bundling alone.

## Reconnect and foreground retry counts

In saved-session recovery tests, a network reconnect while backgrounded and the later foreground transition are separate retry triggers. Count one verification for each event; reopening the fixture route through Expo Go is not a substitute for collapsing them into one.

**Why:** The recovery unit test expects one request on the online edge and another on foreground resume. A native retry assertion that expected only one for both events failed; the screen showed the correctly verified session after the fourth attempt.

**How to apply:** Keep Maestro attempt-count assertions aligned with the network-edge and resume contract, and verify the final saved-session state without adding an extra connectivity cycle after verification succeeds.

## Chrome custom-tab first run

On a fresh Android emulator, Chrome's first-run welcome screen can intercept the app's OAuth custom tab before the local test page appears. The native OAuth flow should dismiss that prompt when present before waiting for its fixture page.

**Why:** The Android emulator's first external-browser launch showed Chrome's welcome/sign-in screen instead of the expected local OAuth button; the app and fixture server were running normally.

**How to apply:** Make the browser onboarding tap optional in the first custom-tab flow so the same test works both before and after Chrome has been initialized.

Expo Go native-auth fixtures must use the runtime-generated `exp://` callback, while the standalone app keeps its registered `daily007://` callback. Passing the standalone scheme to Chrome in Expo Go can leave the custom tab open instead of returning to the app.

**Why:** The native test reached its local OAuth page but did not return after tapping the callback because Expo Go did not handle the production app scheme.

**How to apply:** In test-only harnesses, validate the production redirect contract, then create the callback with `AuthSession.makeRedirectUri` and no explicit scheme. Keep production callback configuration unchanged.
