---
name: pnpm patched dependency verification
description: Verify security patches when pnpm audit still flags the upstream package version.
---

`pnpm audit` can continue to report a vulnerable upstream version after `patchedDependencies` is applied because the audit is version-based and does not inspect the patch contents. Confirm the lockfile parent points to the snapshot with `patch_hash`, then load the dependency through its actual transitive parent and run a focused regression test. Root-level hoisted links may still point to an unpatched or stale copy, so a root `require()` is not sufficient verification.

**Why:** fixed upstream npm releases may not exist yet, so a local backport can close the code vulnerability before the advisory database recognizes a safe version.

**How to apply:** report both facts accurately: the vulnerable version remains in audit output, and whether the patched runtime path passes the security regression test. Exercise it through the actual transitive parent and assert the public behavior (for example, ordinary input still works and deeply nested input is rejected) without overfitting the exact exception class or output representation.

**Why:** patch internals can reject unsafe input with a different exception type than a harness assumes, and package APIs can return different forms depending on options; security tests should validate the boundary users depend on.
