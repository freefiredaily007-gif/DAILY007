---
name: Daily007 invite recovery TalkBack
description: Physical TalkBack confirmation for failed referral-browser-open recovery.
---

On 2026-10-07, the user confirmed the invite recovery announcement on iQOO Neo 10 / Android 16 TalkBack and iPhone VoiceOver. On 2026-10-14, they confirmed on iPhone that VoiceOver could reach and activate Copy referral link and Share invite link after the simulated browser-open failure; copying succeeded and the share sheet opened and was dismissed without sharing.

Real Safari handoffs usually succeed, so use a repeatable development-only failure simulation for physical device checks. Keep that control behind `__DEV__` and check both the rejected and successful open paths.

**Why:** Source tests can verify callback wiring and call counts, but cannot confirm native speech. Natural browser-open rejection is difficult to reproduce reliably on a physical iPhone.

**How to apply:** When the browser-open fallback or its announcement changes, verify on iOS and Android with VoiceOver/TalkBack: no message on screen entry, one recovery announcement after rejection, and no fallback after success.
