---
name: Daily007 fresh-start cutover
description: User-approved reset of unpublished Daily007 data, with a full feature-parity requirement before switching backends.
---

The user approved a fresh start: old accounts, passwords, wallet balances, and registrations from the unpublished hosted app do not need to be imported. Keep the hosted API untouched as a fallback during development, but switch the mobile client to Replit only when all visible features have working replacements, not merely the new registration flow.

**Why:** The user explicitly accepted losing the old unpublished data to avoid a provider export, but also explicitly requested that *all* existing app features remain (payments, withdrawals, videos, referrals, notifications, results) alongside the new tournament modes. A partial API switch would silently break the rest of the app. Hosted data does not need to be remotely deleted.

**How to apply:** Start new Replit accounts at zero, invalidate old stored mobile sessions, never seed sample users/coins as real data, and test monetary actions and admin onboarding before claiming readiness. Manual payment requests need admin verification; submitting a reference cannot itself mint coins. Do not delete the hosted provider's data unless separately authorized and directly accessible.

Keep video coin rewards paused until playback can be verified against a server-controlled catalog or trusted provider. The intended reward policy is 1 coin after 70% watched; the user plans to manage video links through the admin panel in a future change.

**Why:** The inherited video screen simulates playback and can send arbitrary video IDs and completion percentages. Crediting spendable coins from those claims lets anyone mint coins repeatedly. The user specified 1 coin at 70%, but YouTube playback events are client-reported rather than signed server-side completion proofs.

**How to apply:** Keep the video tab honest about reward availability. The current YouTube marker is session-only and must not trigger coin awards. An admin-managed link catalog does not prove that a particular user watched 70%; do not reinstate the award endpoint merely by rate-limiting client-provided IDs. Add trustworthy video identity and server-side completion verification first, then apply the 1-coin, 70% policy.