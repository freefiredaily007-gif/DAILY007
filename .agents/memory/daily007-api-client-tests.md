---
name: Daily007 API client tests
description: Node 24 test-runner constraints when testing the Expo API client directly.
---

Node's test runner does not resolve the Expo app's extensionless relative TypeScript imports by default. Direct API-client tests can use `registerHooks` to retry extensionless relative imports with a `.ts` suffix and use `mock.module` to isolate native storage, Expo constants, and generated-client dependencies.

**Why:** Importing the real API module through Node otherwise fails before tests run, while importing the real native dependencies would make tests depend on mobile runtime behavior.

**How to apply:** Run with `--experimental-test-module-mocks`; use `defaultExport` for default module mocks and `namedExports` for named imports. When evaluating an extracted API method with `new Function`, inject its module-level constants as well as HTTP/storage mocks. Mock the HTTP client and storage so tests never contact an API or read real account data.
