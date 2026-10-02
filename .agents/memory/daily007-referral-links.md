---
name: Daily007 referral links
description: Product expectations for opening and sharing referral invitations.
---

Referral invites should be directly usable: the shared link is a clickable HTTPS URL that opens signup with the referring code prefilled. The native “open invite” action should use Expo’s explicit browser opener rather than generic URL dispatch or the `daily007://` scheme, so Android opens a Chrome Custom Tab instead of routing back into Expo. Shared and copied links should remain HTTPS. Display a simple, pronounceable five-letter code, and keep previously issued codes valid so existing invites do not break.

**Why:** The user reported referral links were not clickable and referral codes were too long to remember, then reported Android still routed a generic HTTPS open back into Expo.

**How to apply:** Use the explicit browser API for the in-app open action; keep shared URLs HTTPS, preserve incoming app-scheme handling for older links, accept legacy codes during signup, and keep the existing referral reward policy unchanged.