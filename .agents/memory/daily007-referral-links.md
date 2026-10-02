---
name: Daily007 referral links
description: Product expectations for opening and sharing referral invitations.
---

Referral invites should be directly usable: the shared link is a clickable HTTPS URL that opens signup with the referring code prefilled. In the native app, tapping the invite should try the `daily007://` scheme; sharing should use the HTTPS link.

**Why:** The user reported that referral invites were not clickable and did not open directly.

**How to apply:** Preserve both the public web referral link and native scheme handling when changing signup or referral flows. Keep the existing referral reward policy unchanged.