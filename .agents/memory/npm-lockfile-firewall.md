---
name: Npm lockfiles on Replit
description: A Replit package-firewall URL rewrite quirk affecting portable npm lockfiles.
---

When a portable npm lockfile contains public-registry `resolved` tarball URLs for package names beginning with `npm-`, npm in this environment may rewrite them into incorrect package-firewall paths and return a 404. Omit only those affected `resolved` fields while retaining their versions and integrity hashes; `npm ci` then resolves them through the configured firewall registry. Do not bypass the firewall or hardcode internal registry URLs into the portable lockfile.

**Why:** The correct firewall paths returned 200, but npm's rewritten paths omitted the registry prefix and returned 404. A clean install succeeded after the affected `resolved` fields were omitted.

**How to apply:** If a future lockfile refresh reintroduces this specific 404, check the requested URL against the configured registry route before changing package versions. Keep the security policy in place and rerun a clean install after editing the lockfile.