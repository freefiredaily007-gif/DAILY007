---
name: API test execution
description: TypeScript test-runner constraints for the API server workspace.
---

Run API-server TypeScript tests through the existing esbuild bundler before invoking Node's test runner. Keep application imports extensionless so the API-server TypeScript configuration accepts them.

**Why:** The workspace does not provide `tsx`, and Node 24's native type stripping did not resolve the API server's extensionless ESM imports. Adding `.ts` to an application import then failed the API-server type check.

**How to apply:** For focused `*.test.ts` runs, invoke the API workspace's binary with `pnpm --filter @workspace/api-server exec esbuild`, bundle the test entry point as CommonJS, write it to a temporary location, then run `node --test`. Root-level `pnpm exec esbuild` does not resolve this binary. An ESM bundle can fail with `Dynamic require of "tty" is not supported` through Express/debug.

Route-level tests that import `@workspace/db` may also need an esbuild alias to a temporary pool stub. Node 24 can resolve the workspace package to TypeScript source with extensionless directory imports, which its native loader rejects.

**Why:** The package points at source that is valid for the workspace bundler but not Node's ESM directory-resolution rules.

**How to apply:** Keep the stub outside the workspace, export a minimal `pool` with `query`/`connect`, and alias `@workspace/db` only for tests that exercise pure route helpers without making database calls.