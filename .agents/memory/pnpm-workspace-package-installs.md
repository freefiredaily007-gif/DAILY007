---
name: Workspace-scoped package installs
description: Keep artifact dependencies in their owning package when the generic package installer targets a pnpm monorepo root.
---

In a pnpm workspace, add a runtime dependency to the owning artifact package with a workspace filter (for example, `pnpm --filter @workspace/daily007 add <package>`). The generic Replit language-package installer may run a bare `pnpm add` from the monorepo root, which refuses to add the package there.

**Why:** Artifact dependencies belong to their own workspace importer; putting them at the root can hide a missing package declaration and make the application depend on accidental hoisting.

**How to apply:** When a package install callback fails with pnpm's workspace-root guard, use a package-filtered install for the intended artifact and verify both its manifest and the shared lockfile changed.
