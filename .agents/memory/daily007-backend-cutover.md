---
name: Daily007 backend cutover
description: Why the new Replit registration backend must remain isolated until account and wallet data can be migrated safely.
---

Build replacement registration rules alongside the hosted Daily007 service, but do not switch existing players to the replacement before an audited data export, account mapping, and wallet reconciliation.

**Why:** The hosted service owns existing identities and coin balances. Its server code and export mechanism were not available when the replacement was started. A premature switch would make accounts appear missing or coins disappear; dual writes could charge or award coins twice. The user approved building a new backend with a migration plan, not losing existing data.

**How to apply:** Keep production login and wallet traffic on the hosted service until import and complete API compatibility are verified. Do not treat local seed users as real accounts. Coordinate a write freeze, final delta, and rollback reconciliation before cutover.