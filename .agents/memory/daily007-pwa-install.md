---
name: Daily007 Chrome PWA install and release updates
description: Android confirmation of PWA installation, standalone launch, and a web-only release update.
---

The user confirmed Chrome on Android 16 offered “Install app” for the published Daily007 site and the installed app opened without Chrome’s address bar. On 2026-10-20, the user also confirmed the installed app displayed `1.0.1+web.20261020` after a web-only release check and said the relaunch/offline checks looked good. However, a cache-busted fetch of the configured primary public URL still served a JavaScript bundle without that marker; the installed app’s origin was not confirmed.

**Why:** A valid manifest and service-worker response do not prove Chrome surfaces installation, that an installed app updates, or that the currently published URL serves the same release the user sees on-device.

**How to apply:** Repeat real-device installation, standalone launch, update, and offline checks after PWA changes. When a device reports a release marker that is absent from the public bundle, confirm the installed origin and compare the served JavaScript before claiming the public URL is up to date.
