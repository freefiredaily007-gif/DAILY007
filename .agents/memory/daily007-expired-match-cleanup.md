---
name: Daily007 expired-match cleanup
description: Retention behavior and immutable wallet-history requirements for scheduled tournament cleanup.
---

**Rule:** Delete matches whose scheduled starts are at least 72 hours old, along with their registrations, roster/squad data, and result-award rows. Never modify user profiles, wallet balances, wallet-ledger rows, or player stats. Keep ledger match and registration IDs even after their referenced rows are removed. Managed production can retain stale foreign keys until Publish applies the schema diff.

**Why:** The user chose full expired-match cleanup while preserving financial and account history; ledger foreign keys would otherwise block deletion or require changing transaction rows. The development schema can be correct while production still enforces old ledger constraints.

**How to apply:** Keep the schema’s ledger match/registration identifiers non-relational and verify cleanup against isolated PostgreSQL. Check development and production separately; use the supported dev schema push and Replit Publish flow for managed production. Never run cleanup against production as a test or use direct production DDL.
