---
name: Daily007 Google auth concurrency tests
description: Deterministically exercise identity-scoped transaction locks in Google sign-in route tests.
---

For Google signup races, synchronize requests at the advisory-lock query in the isolated fixture instead of relying on concurrent HTTP calls alone; password hashing can make those transactions enter sequentially. Same-identity requests should contend on one transaction-scoped lock. Different identities should not contend, and rolling back one transaction must preserve another transaction's committed signup.

**Why:** A prior concurrency test produced correct repeat-sign-in outcomes without exercising the identity lock. Whole-database rollback snapshots can also erase unrelated work committed while a transaction is open.

**How to apply:** Use a bounded barrier to put requests at the lock query together. Assert one waiter for same-identity requests and no wait for distinct identities. For distinct identities, keep the injected-failure transaction open until the other signup commits, then assert rollback removes only the failed signup's state.

For signup-reward transaction tests, assert the isolated fixture's persisted ledger unless the fixture also models the full Wallet-history query.

**Why:** The Wallet endpoint uses an expanded ledger query with tournament and result joins that the signup fixture may not support, so a history assertion can fail for fixture reasons rather than signup behavior.

**How to apply:** Keep signup reward-count assertions on the fixture ledger. Add Wallet-history checks only when the fixture handles the endpoint's current SQL shape.

For PostgreSQL row-lock races, monitor `pg_stat_activity` through the connection that holds the test lock, rather than acquiring another pool connection after multiple requests are waiting. A queued query may report an earlier waiter as its blocker, so assert the observed lock-wait chain rather than only the root lock holder.

**Why:** The API test pool can be exhausted by a blocker plus multiple requests waiting on it, and PostgreSQL reports soft blockers from the lock queue as well as the transaction holding the row lock.

**How to apply:** Reuse the lock-holder client's connection for lock-state polling, clear its statistics snapshot between polls, and confirm each expected query is waiting before releasing the row lock.
