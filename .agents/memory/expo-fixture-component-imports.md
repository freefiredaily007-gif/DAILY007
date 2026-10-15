---
name: Expo fixture component imports
description: Avoid app-root import cycles when native Expo test routes reuse production UI.
---

Development-only Expo Router fixtures should reuse production UI through a standalone component module rather than importing a full screen that itself imports the app root.

**Why:** Importing the Home screen solely to reuse its cards introduced an App → Home → App cycle in the fixture route and yielded a blank web preview. Moving the card UI into its own module restored rendering while keeping the fixture on production visuals and route parameters.

**How to apply:** When a native fixture needs part of an app screen, extract or reuse a child component that does not import app context, navigation roots, or the screen’s parent module. Keep route-specific state and deterministic fixture data in the fixture.
