---
name: React Native DevTools in GitHub Actions
description: Headless Android Metro startup and the optional React Native debugger shell.
---

**Rule:** In headless GitHub Actions Metro checks, disable the optional standalone Fusebox shell only for the CI Metro process. Its Electron/DotSlash startup can fail on hosted runners when the SUID sandbox helper is unavailable.

**Why:** React Native 0.86 enables the standalone debugger shell by default, and its startup can prevent the emulator verification script from observing Metro as ready even though this debugger UI is not needed by the test.

**How to apply:** Keep the override scoped to the Android emulator CI process. Preserve normal local DevTools behavior and verify the Metro middleware initialization plus the emulator verification tests.
