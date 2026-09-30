# Daily007 backend migration plan

## Current state

The mobile app currently uses a hosted Daily007 API for login, balances, tournaments, registrations, rooms, and other features. A separate Replit API now contains an isolated v2 game-registration service. Its user accounts, balances, and matches are **not** the hosted accounts. Do not point the existing app at v2 or publish a replacement until the remaining API functions and the data migration are ready.

The v2 schema is maintained in `lib/db/src/schema` and is applied to the development database with the workspace's normal Drizzle push. For a Replit-managed production database, schema changes are applied through Replit Publish, not a custom production migration script.

## Data required from the hosted provider

Request a complete, timestamped export or authorized API access for:

- Users: stable IDs, email, name, role, status, and game UID; password hashes only if the provider documents a compatible and safe import format. Otherwise require users to reset their passwords. Never export plaintext passwords.
- Wallets: current coin balances **and** the transactions needed to reconcile each balance, including pending payments, refunds, withdrawals, and prize awards.
- Tournaments/matches: IDs, mode, team type, kickoff with timezone, fee, capacity, status, and any room credentials.
- Registrations: tournament ID, captain's user ID and game UID, teammates, status, fee actually paid, refunds, and timestamps.
- Other app features still served by the hosted API: settings, notifications, results, payments, referrals, and admin-managed content.

The hosted service's data and export mechanism are not available in this workspace. No live data has been copied or deleted. Never treat the example `seed.json` users or balances as real accounts.

## Mapping and dry run

1. Agree on a freeze/cutover window and take a provider-side backup/export before changes.
2. Build an import mapping keyed by the old stable IDs. Normalize email casing, mode values, timezone, and user/registration statuses. Resolve duplicate accounts and conflicting registrations manually; do not invent balances.
3. Import into an isolated test database first. Preserve old IDs in an audit mapping, and import wallet opening balances through auditable ledger entries. Do not send migrated users a default shared password.
4. Compare counts and samples by mode, match, registration status, and user. Reconcile **every** wallet balance against provider totals, including pending money movements. Confirm no match exceeds 48 solo players, 12 squad teams, or 2 Clash teams; exceptions need explicit decisions rather than silent truncation.
5. Verify login/password-reset or account-linking, registration retry/last-slot concurrency, insufficient coins, room visibility, admin CSV export, and the rest of the existing app flows against imported data. The v2 API currently covers only registration-specific functionality; the other hosted routes must be ported or safely bridged before a full switch.

## Cutover and rollback

1. Only after the dry run and account/balance reconciliation, publish the new schema using Replit's Publish flow. Use an approved, one-time production data import mechanism; never run database pushes or custom DDL from an app startup/build command.
2. Freeze new writes to the hosted service, take a final export, import the final delta idempotently, then recheck counts and wallet totals. Avoid dual-writing coins across the two services.
3. Switch the mobile API configuration and release only after the new backend has a complete compatible API and the end-to-end checks pass. Keep the hosted service and backup read-only during the observation window.
4. If cutover fails, pause new writes before switching back. Reconcile any transactions accepted by v2 during the window so rollback cannot duplicate or lose coins.

## Before v2 can be used

- The v2 API currently uses the workspace-managed `SESSION_SECRET` as its signing key; a dedicated `DAILY007_AUTH_SECRET` can override it. Configure the one-time admin bootstrap secret through workspace secrets tooling; do not commit it. Create the first admin by the documented authenticated bootstrap flow, then remove its one-time secret. The old seeded admin password is **not** a v2 credential.
- Obtain the hosted export and confirm how existing passwords/account ownership will be handled.
- Port or bridge the remaining hosted app features and connect the mobile client to v2 with its own authenticated session.
- Run real database-backed tests for concurrent final-slot registrations and payment retries before enabling coin deductions for users.