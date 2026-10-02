---
name: Daily007 tournament auto-confirmation
description: Product rule for confirming tournament registrations and deducting entry fees.
---

**Rule:** Confirm new tournament registrations immediately when the user joins. Deduct any entry coins once in the same transaction; free tournaments confirm without a charge.

**Why:** The user requested direct confirmation and wallet deduction instead of waiting for admin approval.

**How to apply:** Keep the registration confirmation, wallet update, ledger entry, and capacity update atomic. Preserve older pending registrations for admin review unless the user explicitly asks to change them.