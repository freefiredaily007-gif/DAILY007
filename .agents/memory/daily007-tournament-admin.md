---
name: Daily007 Tournament Admin scope
description: User-defined permission boundary between full Admin and tournament-only Admin accounts.
---

A Tournament Admin can manage tournaments, registrations, rooms, results, and tournament winner payouts. They cannot manage general wallet credits, payment or recharge approvals, withdrawals, or earn-task reward approvals. Only a Full Admin assigns or removes Tournament Admin access directly in User Management; players do not self-request.

**Why:** The user chose all tournament operations, including registrations and room management, while explicitly excluding non-tournament coin approvals and withdrawals. They clarified that the main Full Admin must assign the role directly, not process player requests.

**How to apply:** Keep the boundary in both server authorization and Admin navigation. Treat User Management as the sole route for assigning the role. Do not expand tournament permissions to unrelated wallet or reward workflows.