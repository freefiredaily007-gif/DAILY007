---
name: Daily007 expired-match cleanup
description: Retention behavior and immutable wallet-history requirements for scheduled tournament cleanup.
---

**Rule:** Delete matches whose scheduled starts are at least 72 hours old, along with their registrations, roster/squad data, and result-award rows. Never modify user profiles, wallet balances, wallet-ledger rows, or player stats. Keep ledger match and registration IDs even after their referenced rows are removed.

**Why:** The user chose full expired-match cleanup while preserving financial and account history; ledger foreign keys would otherwise block deletion or require changing transaction rows.

**How to apply:** Keep the schema’s ledger match/registration identifiers non-relational and verify cleanup against isolated PostgreSQL. Replit’s Publish flow applies schema changes to production; do not run a live cleanup as a test.
