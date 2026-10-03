---
name: Daily007 production tournament data
description: User-approved scope for aligning live tournament rows with development.
---

**Rule:** The user chose to replace the current production tournament records with the current development tournament set, not to overwrite the whole production database.

**Why:** Production and development tournament rows differ, and the user selected replacement after being warned that attached registration or result history could be affected.

**How to apply:** Replace tournament rows only. Preserve accounts, wallets, and unrelated records; verify registrations, awards, and wallet-ledger links before deleting. Never use the whole-database overwrite option for this request.