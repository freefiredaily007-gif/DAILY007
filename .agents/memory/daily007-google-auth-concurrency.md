---
name: Daily007 Google auth concurrency tests
description: Deterministically exercise identity-scoped transaction locks in Google sign-in route tests.
---

For same-identity Google signup races, synchronize requests at the advisory-lock query in the isolated fixture, model the lock as transaction-scoped, and assert a waiter was observed. Concurrent HTTP requests alone may enter the database sequentially because password hashing completes at different times.

**Why:** A first concurrency attempt produced correct sequential repeat-sign-in outcomes without exercising the identity lock.

**How to apply:** Add a bounded fixture barrier so both same-identity requests reach the lock query before either proceeds. Hold the fixture lock until commit or rollback, refresh the waiting transaction's rollback snapshot after lock acquisition, and assert contention as well as final account, referral, and reward state.
