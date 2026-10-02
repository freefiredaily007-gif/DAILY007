---
name: Daily007 Tournament Admin scope
description: User-defined permission boundary between full Admin and tournament-only Admin accounts.
---

A Tournament Admin can manage tournaments, registrations, rooms, results, and tournament winner payouts. They cannot manage general wallet credits, payment or recharge approvals, withdrawals, or earn-task reward approvals. A player can request access from Profile, but only a Full Admin can approve or reject the request in the Access queue; Full Admins may also assign or remove the role in User Management.

**Why:** The user chose all tournament operations, including registrations and room management, while explicitly excluding non-tournament coin approvals and withdrawals. They also expect requests made from another account to appear in the main Admin panel.

**How to apply:** Keep the boundary in both server authorization and Admin navigation. Never grant the role when a request is submitted; require an explicit Full Admin decision. Do not expand tournament permissions to unrelated wallet or reward workflows.