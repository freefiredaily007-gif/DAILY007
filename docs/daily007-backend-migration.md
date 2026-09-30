# Daily007 fresh-start backend cutover

## Current state

The original mobile app used a hosted Daily007 API for login, balances, tournaments, registrations, rooms, payments, and other features. The user confirmed this app has not been published and authorized a fresh start in which old accounts, balances, and match data do **not** move to the new Replit backend. This removes the export/import requirement, but not the need to rebuild and verify every screen before switching traffic. Existing hosted data should be left alone rather than deleted remotely; the replacement starts with empty Replit tables.

The v2 schema is maintained in `lib/db/src/schema` and is applied to the development database with the workspace's normal Drizzle push. For a Replit-managed production database, schema changes are applied through Replit Publish, not a custom production migration script.

## Google sign-in

Google is an additional sign-in option, not a replacement for Daily007 email/password accounts. Replit-managed Clerk handles the Google OAuth session; the server verifies that session and a verified Google identity before issuing the same Daily007 bearer token used by the wallet and tournament APIs. New Google accounts start with zero coins and no usable password. A Google email that already belongs to a password account is **not** linked automatically: sign in with the password first and use **Profile → Connect Google**. Referral codes entered on a new Google signup are tracked as pending without crediting coins.

The web preview was checked through the Google sign-in page and password-login fallback; a full Google callback and native-device sign-in still require a real Google account and device/build verification. Do not store Google access tokens in the Daily007 database or treat a client-supplied email as proof of identity.

## Fresh-start decision and consequences

- New and old accounts are separate. Old passwords and sessions will not work; everyone signs up again. The mobile client must use a new local session key so an old hosted token is never sent to Replit.
- New wallets start at zero. Admin credits, approved payment requests, rewards, tournament fees, and withdrawals must all be auditable. Do not copy the example `seed.json` users, passwords, or coins.
- A hosted provider export is **not** needed for this fresh start. Do not try to delete the hosted provider's data as part of the cutover; it can remain as an unused safety copy.
- Preserve the existing app's visible features (including payments, withdrawals, videos, referrals, notifications, and results) rather than swapping only login and tournament requests and leaving the rest broken.
- Manual payment submissions must never credit coins on their own. An authorized administrator must configure the payment UPI ID, verify each reference outside the app, and approve each request. Withdrawal approval records a **manual payout still required**; it does not transfer funds. Rejected requests refund reserved coins once.
- The video tab remains available, but spendable video rewards are paused because the existing simulated watch action cannot prove a real view. Referral codes and referred signups are tracked, but no bonus coins are issued without verification.
- Publish only after the fresh client, admin onboarding, money flows, and simultaneous final-slot registrations are tested against Replit's backend.

## If a data-preserving migration is requested later

Request a complete, timestamped export or authorized API access for:

- Users: stable IDs, email, name, role, status, and game UID; password hashes only if the provider documents a compatible and safe import format. Otherwise require users to reset their passwords. Never export plaintext passwords.
- Wallets: current coin balances **and** the transactions needed to reconcile each balance, including pending payments, refunds, withdrawals, and prize awards.
- Tournaments/matches: IDs, mode, team type, kickoff with timezone, fee, capacity, status, and any room credentials.
- Registrations: tournament ID, captain's user ID and game UID, teammates, status, fee actually paid, refunds, and timestamps.
- Other app features still served by the hosted API: settings, notifications, results, payments, referrals, and admin-managed content.

The hosted service's data and export mechanism are not available in this workspace. No live data has been copied or deleted. Never treat the example `seed.json` users or balances as real accounts.

### Mapping and dry run

1. Agree on a freeze/cutover window and take a provider-side backup/export before changes.
2. Build an import mapping keyed by the old stable IDs. Normalize email casing, mode values, timezone, and user/registration statuses. Resolve duplicate accounts and conflicting registrations manually; do not invent balances.
3. Import into an isolated test database first. Preserve old IDs in an audit mapping, and import wallet opening balances through auditable ledger entries. Do not send migrated users a default shared password.
4. Compare counts and samples by mode, match, registration status, and user. Reconcile **every** wallet balance against provider totals, including pending money movements. Confirm no match exceeds 48 solo players, 12 squad teams, or 2 Clash teams; exceptions need explicit decisions rather than silent truncation.
5. Verify login/password-reset or account-linking, registration retry/last-slot concurrency, insufficient coins, room visibility, admin CSV export, and the rest of the existing app flows against imported data. The v2 API currently covers only registration-specific functionality; the other hosted routes must be ported or safely bridged before a full switch.

### Cutover and rollback for a data-preserving migration

1. Only after the dry run and account/balance reconciliation, publish the new schema using Replit's Publish flow. Use an approved, one-time production data import mechanism; never run database pushes or custom DDL from an app startup/build command.
2. Freeze new writes to the hosted service, take a final export, import the final delta idempotently, then recheck counts and wallet totals. Avoid dual-writing coins across the two services.
3. Switch the mobile API configuration and release only after the new backend has a complete compatible API and the end-to-end checks pass. Keep the hosted service and backup read-only during the observation window.
4. If cutover fails, pause new writes before switching back. Reconcile any transactions accepted by v2 during the window so rollback cannot duplicate or lose coins.

## Fresh-start launch checklist

- The v2 API uses the workspace-managed `SESSION_SECRET` as its signing key; a dedicated `DAILY007_AUTH_SECRET` can override it. Configure `DAILY007_ADMIN_BOOTSTRAP_TOKEN` (at least 32 random characters) through workspace secrets tooling; do not commit it. Sign up with your own account, then use **Profile → Set Up Admin** and the one-time code to become the first admin. Remove the bootstrap secret afterward. The old seeded admin password is **not** a v2 credential.
- Confirm all visible screens use the new Replit API with fresh sessions and no hosted fallback. Additive schema changes use development Drizzle push and Replit Publish for managed production schema changes; do not run DDL during app startup.
- Verify fresh signup/login, empty and funded wallet, solo/squad/clash form and fixed capacity, atomic fee deduction and retry, room release, admin export, payment/withdrawal approval and rejection, results and rewards, and the remaining tabs.
- Run real database-backed tests for concurrent final-slot registrations and payment retries before enabling coin deductions for users.