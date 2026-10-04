---
name: Daily007 Home mode-card screen readers
description: Native VoiceOver and TalkBack behavior confirmed for the three Home game-mode cards.
---

On 2026-10-05, the user confirmed that Battle Royale, Clash Squad, and Lone Wolf each appear as one focus stop on both iOS VoiceOver and Android TalkBack. Each announces its mode plus Solo, Duo, and Squad, with no separate focus stops for decorative card text or images.

**Why:** Native focus grouping and spoken output cannot be established from source code or the Expo web preview alone.

**How to apply:** Recheck both screen readers if the Home mode cards or their accessibility wrappers change.