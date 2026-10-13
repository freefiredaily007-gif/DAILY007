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
