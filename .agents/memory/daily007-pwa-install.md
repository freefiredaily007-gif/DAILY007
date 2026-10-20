---
name: Daily007 Chrome PWA install and release updates
description: Android confirmation of PWA installation, standalone launch, and a web-only release update.
---

The user confirmed Chrome on Android 16 offered “Install app” for the published Daily007 site and the installed app opened without Chrome’s address bar. On 2026-10-20, the user also confirmed the installed app displayed `1.0.1+web.20261020` after a web-only release check and said the relaunch/offline checks looked good. However, a cache-busted fetch of the configured primary public URL still served a JavaScript bundle without that marker; the installed app’s origin was not confirmed.

On 2026-10-20, a clean headless Chromium profile also confirmed that the published worker activated and controlled the initial page, cached the page shell, manifest, and both icons with HTTP 200 responses, and served the cached HTML shell for an offline nested-route navigation. A DevTools-forced reload dropped controller state in this headless context, so the offline check was performed from the initially controlled page. The check confirmed the HTML shell, not that the interactive React interface rendered offline.

**Why:** A valid manifest and service-worker response do not prove Chrome surfaces installation, that an installed app updates, or that the currently published URL serves the same release the user sees on-device. Headless DevTools reloads can also lose worker control even when initial control and offline navigation work.

**How to apply:** Repeat real-device installation, standalone launch, update, and offline checks after PWA changes. For headless browser checks, wait for the initial page to be controlled and test offline navigation from that page rather than assuming a forced DevTools reload remains controlled. When a device reports a release marker that is absent from the public bundle, confirm the installed origin and compare the served JavaScript before claiming the public URL is up to date.
