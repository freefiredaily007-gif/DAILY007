---
name: API test execution
description: TypeScript test-runner constraints for the API server workspace.
---

Run API-server TypeScript tests through the existing esbuild bundler before invoking Node's test runner. Keep application imports extensionless so the API-server TypeScript configuration accepts them.

**Why:** The workspace does not provide `tsx`, and Node 24's native type stripping did not resolve the API server's extensionless ESM imports. Adding `.ts` to an application import then failed the API-server type check.

**How to apply:** For focused `*.test.ts` runs, invoke the API workspace's binary with `pnpm --filter @workspace/api-server exec esbuild`, bundle the test entry point as CommonJS, write it to a temporary location, then run `node --test`. Root-level `pnpm exec esbuild` does not resolve this binary. An ESM bundle can fail with `Dynamic require of "tty" is not supported` through Express/debug.

For Node 24 native type-stripping tests, keep imported app helpers free of extensionless TypeScript dependencies or bundle the test with the workspace toolchain. Do not add `.ts` extensions to app imports just to satisfy the test runner.

**Why:** Native Node resolution failed on an extensionless transitive import, while TypeScript rejected changing the app import to end in `.ts`.

**How to apply:** Keep app imports extensionless; make pure test helpers self-contained when practical, otherwise use the workspace esbuild runner.

Route-level tests that import `@workspace/db` need an esbuild alias because Node 24 can resolve the workspace package to TypeScript source with extensionless directory imports, which its native loader rejects.

**Why:** The package points at source that is valid for the workspace bundler but not Node's ESM directory-resolution rules.

**How to apply:** For helper-only route tests, alias `@workspace/db` to a minimal pool stub. When a route test needs database-backed rows or writes, use a strict in-memory fixture under `tests/support` and make unexpected SQL fail; never connect wallet tests to shared data or alter real balances/payment settings. When passing a package-relative alias target via `pnpm --filter @workspace/api-server exec`, prefix it with `./`; a bare `tests/...` target is not resolved.

**Why:** Isolated fixtures let route tests exercise real response serialization without touching shared state, and protect wallet flows from mutating real balances or settings. Esbuild treats a bare alias replacement like a package-style path, so a valid fixture under the API package can still fail to resolve.

When a bundled API test imports the shared logger, run the bundled Node test with `NODE_ENV=production`. The non-production Pino configuration initializes `pino-pretty` dynamically, which can fail from a temporary esbuild bundle.

**Why:** The logger's development transport is resolved at runtime and is not reliably available to a test bundle emitted under `/tmp`.

**How to apply:** Set `NODE_ENV=production` only for the bundled test process; do not change the app's logger or workflow configuration to accommodate tests.

For rollback tests using the in-memory database fixture, capture the relevant state at the injected failure point outside the transaction snapshot.

**Why:** Assertions after rollback prove cleanup but do not prove the request reached the intended failure after its prerequisite writes.

**How to apply:** Record the needed pre-failure evidence immediately before throwing, assert it after the request, and separately compare the database state with its pre-request snapshot.

For isolated PostgreSQL rollback tests, use a sequence increment in a late failure trigger as durable evidence that the trigger ran.

**Why:** The database writes being tested disappear with the rolled-back transaction, so a 500 response alone cannot prove the request reached the intended failure point.

**How to apply:** Increment a test-only sequence immediately before raising from the trigger, assert its value afterward, then compare persisted application rows with their pre-request state.

Keep isolated PostgreSQL fixtures faithful to production defaults for columns the API omits from its inserts.

**Why:** An API path may rely on a database-generated value such as a registration ID; a missing fixture default can produce a generic 500 after the lock behavior itself is correct.

**How to apply:** Compare each route insert with the fixture schema and production defaults, including generated IDs and constraints used by the operation.

When a fixture helper returns seeded rows for later edits, verify whether it returns live objects or clones; mutate the stored rows that route queries read.

**Why:** Editing a returned snapshot can leave the fixture unchanged, causing route assertions to inspect stale values.

**How to apply:** After seeding, update the in-memory fixture collections directly unless the helper documents live-object semantics.

For API handlers that send a response before asynchronous `finally` cleanup completes, wait for the persisted in-flight state to settle before asserting database counters.

**Why:** A client can receive the response before the handler's awaited cleanup finishes, making immediate PostgreSQL assertions intermittently observe a reserved but unsettled attempt.

**How to apply:** In isolated PostgreSQL integration tests, poll for the expected rows with zero in-flight work before checking settled counters.