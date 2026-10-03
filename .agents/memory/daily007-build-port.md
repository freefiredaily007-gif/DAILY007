---
name: Daily007 Expo port management
description: Separate temporary Metro build ports from the managed Expo workflow's injected port.
---

The Daily007 custom build must allocate a free temporary Metro port and use it consistently for server health checks, bundles, manifests, and assets. Do not assume port 8081 is available because another managed workspace service may already use it.

The managed Expo workflow must continue using its injected `PORT`. A stale Metro process can retain that port across a workflow restart, causing a new Expo process to prompt to switch to another port; do not accept the alternate port because artifact routing expects the configured one.

**Why:** Temporary builds have conflicted with another workspace service, and a managed Expo restart has also encountered a stale Metro listener on its assigned port.

**How to apply:** Preserve dynamic port allocation for temporary builds. If the managed Expo workflow asks to shift ports, confirm the listener belongs to Daily007 and restore a single server on the injected port before restarting.