---
name: Daily007 Tournament Admin scope
description: User-defined permission boundary between full Admin and tournament-only Admin accounts.
---

A Tournament Admin can manage tournaments, registrations, rooms, results, and tournament winner payouts. They cannot manage general wallet credits, payment or recharge approvals, withdrawals, or earn-task reward approvals. Do not auto-assign an account; a Full Admin chooses the account in User Management.

**Why:** The user chose all tournament operations, including registrations and room management, while explicitly excluding non-tournament coin approvals and withdrawals.

**How to apply:** Keep the boundary in both server authorization and Admin navigation. Do not expand tournament permissions to unrelated wallet or reward workflows.