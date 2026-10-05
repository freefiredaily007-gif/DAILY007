---
name: API test execution
description: TypeScript test-runner constraints for the API server workspace.
---

Run API-server TypeScript tests through the existing esbuild bundler before invoking Node's test runner. Keep application imports extensionless so the API-server TypeScript configuration accepts them.

**Why:** The workspace does not provide `tsx`, and Node 24's native type stripping did not resolve the API server's extensionless ESM imports. Adding `.ts` to an application import then failed the API-server type check.

**How to apply:** For focused `*.test.ts` runs, invoke the API workspace's binary with `pnpm --filter @workspace/api-server exec esbuild`, bundle the test entry point as CommonJS, write it to a temporary location, then run `node --test`. Root-level `pnpm exec esbuild` does not resolve this binary. An ESM bundle can fail with `Dynamic require of "tty" is not supported` through Express/debug.

Route-level tests that import `@workspace/db` need an esbuild alias because Node 24 can resolve the workspace package to TypeScript source with extensionless directory imports, which its native loader rejects.

**Why:** The package points at source that is valid for the workspace bundler but not Node's ESM directory-resolution rules.

**How to apply:** For helper-only route tests, alias `@workspace/db` to a minimal pool stub. When a route test needs database-backed rows or writes, use a strict in-memory fixture under `tests/support` and make unexpected SQL fail; never connect wallet tests to shared data or alter real balances/payment settings. When passing a package-relative alias target via `pnpm --filter @workspace/api-server exec`, prefix it with `./`; a bare `tests/...` target is not resolved.

**Why:** Isolated fixtures let route tests exercise real response serialization without touching shared state, and protect wallet flows from mutating real balances or settings. Esbuild treats a bare alias replacement like a package-style path, so a valid fixture under the API package can still fail to resolve.

When a bundled API test imports the shared logger, run the bundled Node test with `NODE_ENV=production`. The non-production Pino configuration initializes `pino-pretty` dynamically, which can fail from a temporary esbuild bundle.

**Why:** The logger's development transport is resolved at runtime and is not reliably available to a test bundle emitted under `/tmp`.

**How to apply:** Set `NODE_ENV=production` only for the bundled test process; do not change the app's logger or workflow configuration to accommodate tests.