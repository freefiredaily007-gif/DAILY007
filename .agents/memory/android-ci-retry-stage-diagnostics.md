---
name: Android retry stage diagnostics
description: Distinguish a successful Maestro tap from progress inside a native retry flow.
---

For Android Maestro flows, a successful tap step does not prove the app entered its handler. Record visible fixture-only counters at key boundaries—session lookup, token read, and network exchange—so the earliest unchanged stage isolates the failure. Also assume a screen's scroll offset may be retained between tabs or test routes; do not rely on a single starting position.

**Why:** A retry button was visible and enabled and Maestro reported its tap completed, yet the next network exchange did not appear. Profile navigation also began at different scroll offsets across emulator runs.

**How to apply:** Add non-secret stage diagnostics to native retry fixtures, and do not infer handler execution from tap success or screen visibility alone. Search both directions or reset to a known position before locating a deep screen control.
