---
name: Chromium PWA offline checks
description: Chromium DevTools Protocol requires offline emulation on the service-worker target as well as the page target.
---

In headless Chromium, setting `Network.emulateNetworkConditions({ offline: true })` on the page target changed `navigator.onLine` but did not prevent fetches initiated by its service worker from reaching the network. The offline navigation therefore received the fixture server's 404 instead of exercising the worker's cached-shell fallback. Attaching to the active `service_worker` target and applying the same offline condition there made the fallback test reliable.

**Why:** A browser test can look offline from page JavaScript while a worker's own network fetch still succeeds, producing a false offline result.

**How to apply:** For PWA offline smoke checks through CDP, emulate offline mode in both the page and the active service-worker target, then require an HTTP 200 document response served by the worker.
