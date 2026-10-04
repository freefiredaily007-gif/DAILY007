---
name: Daily007 Android Back behavior
description: Physical Android validation of keyboard-first Back handling in Wallet and Edit Profile.
---

On 2026-10-04, the user confirmed on a physical Android phone that the first hardware Back hid the keyboard while preserving Wallet Add Coins amount, payer UPI, and transaction reference; Wallet Withdraw amount and payout account; and Edit Profile name, phone, and Free Fire UID. Save remained reachable. The second Back closed the Wallet sheet and returned from Edit Profile normally.

**Why:** React Native Web viewport checks cannot dispatch Android's hardware Back, so native keyboard-versus-screen event ordering requires on-device verification.

**How to apply:** Keep Wallet and Edit Profile inputs controlled in screen state, and route Android Wallet Modal Back through the same close path as its Close button. Verify keyboard-first behavior and the second Back on a physical Android device rather than inferring it from browser screenshots.