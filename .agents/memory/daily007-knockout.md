---
name: Daily007 Knockout tournament architecture
description: Integration boundary for the staged Knockout feature and future result processing.
---

Keep Knockout tournaments on the existing tournament match, registration, and wallet transaction flows. The per-match Knockout settings record configures stages; it is not a parallel registration or wallet system.

**Why:** The user asked to preserve existing authentication, joining, captain controls, entry fees, and wallet behavior. A match-scoped settings record also keeps historical stage configuration stable.

**How to apply:** Build later stage results and advancement against the same tournament match and its saved settings. Credit prizes only through the existing wallet ledger and authenticated admin transaction path.
