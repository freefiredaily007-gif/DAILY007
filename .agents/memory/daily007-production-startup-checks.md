---
name: Daily007 production startup checks
description: Interpret brief deployment healthcheck failures during Daily007 multi-artifact startup.
---

During a published startup, probe checks against `/` and `/api` returned HTTP 500 while the API and Expo servers were launching. The API then logged its listener and `/api/healthz` returned 200.

**Why:** A healthy post-start response showed that the earlier probe errors were startup timing, not an ongoing API outage.

**How to apply:** Treat these errors as transient only when they precede server readiness and are followed by HTTP 200 from `/api/healthz`. If they persist after startup, investigate.