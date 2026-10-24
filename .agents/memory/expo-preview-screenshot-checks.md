---
name: Expo preview screenshot checks
description: Distinguishes a blank screenshot capture from an Expo app that failed to render.
---

If an Expo screenshot helper returns a blank page while Metro reports the app running, verify the page DOM and take an independent local Chromium headless screenshot before changing app code. In the Daily007 environment, Chromium also captured white when run immediately; allowing about 15 seconds of virtual time rendered the login screen. The React Native DevTools `libglib-2.0.so.0` warning did not prevent rendering.

**Why:** A single blank capture can misdiagnose a preview-capture problem as a broken app and lead to unnecessary navigation changes.

**How to apply:** Compare the screenshot helper with a DOM dump and a local Chromium screenshot after a virtual-time budget. Do not alter Expo Router's navigation isolation based only on a blank screenshot.