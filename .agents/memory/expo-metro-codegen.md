---
name: Expo Metro during API codegen
description: Distinguish transient Metro module resolution errors during generated API cleanup from persistent failures.
---

**Rule:** When OpenAPI code generation runs while Expo/Metro is active, treat missing generated-module errors during output cleanup as transient only after verifying the generated files exist and Metro later bundles successfully.

**Why:** Orval cleans generated output directories before writing new files, so Metro can briefly resolve imports while generated modules are absent.

**How to apply:** After codegen, verify generated output files and check the latest Metro log tail for a successful bundle; restart or troubleshoot only if the error persists after generation.
