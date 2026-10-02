---
name: Daily007 referral links
description: Product expectations for opening and sharing referral invitations.
---

Referral invites should be directly usable: the shared link is a clickable HTTPS URL that opens signup with the referring code prefilled. The native “open invite” action should use HTTPS directly so the system opens a browser (Chrome only when configured as the default), not the `daily007://` scheme. Shared and copied links should remain HTTPS. Display a simple, pronounceable five-letter code, and keep previously issued codes valid so existing invites do not break.

**Why:** The user reported referral links were not clickable and referral codes were too long to remember, then asked that tapping an invite open in a browser instead of routing invitees into Expo.

**How to apply:** Use HTTPS for outbound invites, preserve incoming app-scheme handling for older links, accept legacy codes during signup, and keep the existing referral reward policy unchanged.