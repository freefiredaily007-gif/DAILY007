---
name: Daily007 Google auth concurrency tests
description: Deterministically exercise identity-scoped transaction locks in Google sign-in route tests.
---

For Google signup races, synchronize requests at the advisory-lock query in the isolated fixture instead of relying on concurrent HTTP calls alone; password hashing can make those transactions enter sequentially. Same-identity requests should contend on one transaction-scoped lock. Different identities should not contend, and rolling back one transaction must preserve another transaction's committed signup.

**Why:** A prior concurrency test produced correct repeat-sign-in outcomes without exercising the identity lock. Whole-database rollback snapshots can also erase unrelated work committed while a transaction is open.

**How to apply:** Use a bounded barrier to put requests at the lock query together. Assert one waiter for same-identity requests and no wait for distinct identities. For distinct identities, keep the injected-failure transaction open until the other signup commits, then assert rollback removes only the failed signup's state.
