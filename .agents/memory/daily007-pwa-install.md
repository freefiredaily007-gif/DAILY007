---
name: Daily007 Chrome PWA install
description: Real-device confirmation of Chrome installation and standalone launch.
---

The user confirmed Chrome on Android 16 offered “Install app” for the published Daily007 site and the installed app opened without Chrome’s address bar. The Chrome version was not provided.

**Why:** A valid manifest and service-worker response do not prove Chrome surfaces installation or that the installed app launches in standalone mode.

**How to apply:** Treat this as the last verified device baseline. Repeat the real-device install and standalone-launch check after changes to the PWA page, manifest, or service worker; record the browser version when available.
