---
name: Daily007 referral links
description: Product expectations for opening and sharing referral invitations.
---

Referral invites should be directly usable: the shared link is a clickable HTTPS URL that opens signup with the referring code prefilled. The public URL root must serve the exported Daily007 browser app, not an Expo Go launcher page. The native “open invite” action should use Expo’s explicit browser opener rather than generic URL dispatch or the `daily007://` scheme, so Android opens a Chrome Custom Tab instead of routing back into Expo. Shared and copied links should remain HTTPS. Display a simple, pronounceable five-letter code, and keep previously issued codes valid so existing invites do not break.

**Why:** The user reported referral links were not clickable and referral codes were too long to remember, then clarified that invitees must use Daily007 in Chrome without an Expo launch or app redirect.

**How to apply:** Serve the web export at `/` and keep native Expo manifests on their existing routes; use the explicit browser API for the in-app open action; preserve HTTPS query parameters, old app-scheme links, legacy referral codes, and the existing reward policy.

On 2026-10-04, the user confirmed that the installed Android app's **OPEN INVITE** action opened the HTTPS signup page in a browser rather than an Expo launcher, and signup applied the exact referral code shown in Earn.

For referral code and invite-link copies, treat a resolved `false` from Expo Clipboard as a failed write, just like a rejection; keep the alternate share path available and do not show copied-success feedback.

**Why:** `Clipboard.setStringAsync` resolves to a boolean, so a failed write may not throw.

**How to apply:** Check the resolved value before showing success for referral copy actions, and preserve an alternate sharing path on either failure mode.

On 2026-10-14, the user confirmed Android's native share chooser opened after referral-code copying failed, showed the invite URL and referral code, and returned to a usable Earn screen with the recovery message visible.

**Why:** The Android Share API was previously covered only by a mock, so native chooser behavior needed real-device confirmation.

**How to apply:** Preserve the invite content and visible recovery state when clipboard copying fails; keep the Android Maestro flow as regression coverage.

On 2026-10-20, the user confirmed that with Daily007 fully closed, opening `daily007://signup?ref=TEST01` on Android launched Sign Up with `TEST01` applied.

**Why:** Source tests cannot confirm that Android launches the app from an external custom-scheme link before Auth consumes the initial URL.

**How to apply:** Preserve the native-intent rewrite from legacy signup links to the Auth entry route, and repeat a real cold-start check after changing Expo Router or referral URL handling.
