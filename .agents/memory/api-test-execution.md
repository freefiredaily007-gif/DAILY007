---
name: API test execution
description: TypeScript test-runner constraints for the API server workspace.
---

Run API-server TypeScript tests through the existing esbuild bundler before invoking Node's test runner. Keep application imports extensionless so the API-server TypeScript configuration accepts them.

**Why:** The workspace does not provide `tsx`, and Node 24's native type stripping did not resolve the API server's extensionless ESM imports. Adding `.ts` to an application import then failed the API-server type check.

**How to apply:** For focused `*.test.ts` runs, bundle the test entry point for Node with esbuild, write the bundle to a temporary location, then run `node --test` on that bundle.