---
name: Daily007 GitHub write access
description: Distinguishes Replit Git pane connection status from shell GitHub write access.
---

Do not treat a Git pane “Active” badge or a configured Git remote as proof that workspace shell commands can push or dispatch Actions. Public reads may work anonymously while write credentials are unavailable or rejected.

**Why:** During hosted Android verification, the Git pane showed GitHub as active, but the integration remained unattached in the agent environment, `gh` was unauthenticated, and Git push dry runs failed or timed out.

**How to apply:** Before attempting a public upload or claiming an Actions dispatch is possible, verify write authorization through a non-mutating check. Never publish the existing history without excluding signing keys and private workspace metadata.
