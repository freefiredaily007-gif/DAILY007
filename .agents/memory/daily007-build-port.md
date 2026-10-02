---
name: Daily007 temporary build port
description: Avoid port conflicts when the custom Expo build starts its temporary Metro server.
---

The Daily007 custom build must allocate a free temporary Metro port and use it consistently for server health checks, bundles, manifests, and assets. Do not assume port 8081 is available because another managed workspace service may already use it.

**Why:** A full build failed in the Replit workspace when the component-preview service occupied Metro's default port and Expo CLI could not prompt to switch ports.

**How to apply:** Preserve dynamic port allocation whenever changing the custom native or web build flow.