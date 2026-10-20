---
name: Daily007 Chrome PWA install and release updates
description: Android confirmation of PWA installation, standalone launch, and a web-only release update.
---

The user confirmed Chrome on Android 16 offered “Install app” for the published Daily007 site and the installed app opened without Chrome’s address bar. On 2026-10-20, the user also confirmed the installed app displayed `1.0.1+web.20261020` after a web-only release check and said the relaunch/offline checks looked good. The user confirmed the existing install updated in place without creating a second Daily007 launcher install. The Chrome version was not captured, and the installed app’s origin was not confirmed. A cache-busted fetch of the configured primary public URL still served a JavaScript bundle without that marker.

On 2026-10-20, a clean headless Chromium profile also confirmed that the published worker activated and controlled the initial page, cached the page shell, manifest, and both icons with HTTP 200 responses, and served the cached HTML shell for an offline nested-route navigation. A DevTools-forced reload dropped controller state in this headless context, so the offline check was performed from the initially controlled page. The check confirmed the HTML shell, not that the interactive React interface rendered offline.

On 2026-10-20, desktop Chrome 152.0.7977.64 against the published Daily007 URL reported no manifest or installability errors and fired `beforeinstallprompt`. This is a desktop installability signal, not proof that Android Chrome shows its “Install app” menu item.

**Why:** A valid manifest, service-worker response, or desktop installability event does not prove the Android-specific installation UI appears, that an installed app updates, or that the currently published URL serves the same release the user sees on-device. Headless DevTools reloads can also lose worker control even when initial control and offline navigation work.

**How to apply:** Use desktop Chromium's manifest/installability errors and `beforeinstallprompt` event for automated checks, but verify Android Chrome's actual “Install app” option on a real device after PWA changes. Repeat standalone launch, update, and offline checks separately. For headless cache tests, use the initially controlled page rather than assuming a forced DevTools reload remains controlled. When a device reports a release marker absent from the public bundle, confirm the installed origin and compare the served JavaScript before claiming the public URL is up to date.
