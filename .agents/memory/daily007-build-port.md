---
name: Daily007 Expo build isolation
description: Temporary Metro port allocation and headless publishing in the Nix environment.
---

The Daily007 custom build must allocate a free temporary Metro port and use it consistently for server health checks, bundles, manifests, and assets. Do not assume port 8081 is available because another managed workspace service may already use it.

The managed Expo workflow must continue using its injected `PORT`. A stale Metro process can retain that port across a workflow restart, causing a new Expo process to prompt to switch to another port; do not accept the alternate port because artifact routing expects the configured one.

**Why:** Temporary builds have conflicted with another workspace service, and a managed Expo restart has also encountered a stale Metro listener on its assigned port.

**How to apply:** Preserve dynamic port allocation for temporary builds. If the managed Expo workflow asks to shift ports, confirm the listener belongs to Daily007 and restore a single server on the injected port before restarting.

## Android emulator CI readiness

`Waiting on http://localhost:<port>` is not proof of readiness. Check Metro's host `/status`, then use the actual Maestro `openLink` flow to verify Expo Go can load the app through ADB reverse. Do not gate the test run on an Android shell `toybox nc` request.

**Why:** CI showed a valid ADB reverse mapping but an empty response from `toybox nc`, which stopped the job before the existing app-level Maestro checks could test the same Expo Go URL.

**How to apply:** Keep the ADB reverse setup, distinguish host readiness from device reachability, and let Maestro's launch-and-screen assertions establish device connectivity. Reapply and verify the reverse mapping before each suite because it may disappear between Maestro launches. When Maestro fails, preserve its output and the reverse mapping in the run details.

## Headless publishing

Publish bundling should use Expo's headless mode. `--no-dev` alone does not prevent the CLI from initializing the standalone desktop debugger.

**Why:** The publish environment lacks desktop GUI libraries required by React Native DevTools. That installer warning has appeared in successful builds too, so it is not by itself evidence of a fatal bundler failure.

**How to apply:** Keep publishing subprocesses headless and non-interactive. Diagnose the terminal failing step and Metro's HTTP readiness or process exit, allow for cold startup, and do not add desktop GUI dependencies merely to suppress an optional debugger warning.