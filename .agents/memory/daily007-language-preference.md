---
name: Daily007 language preference sync
description: Server sync is approved for signed-in players; guests and offline reads still use local preferences.
---

Treat the server language as authoritative for signed-in players so a preference follows them across devices. Keep a per-player local copy for offline fallback, and keep guest choices in memory until sign-in.

**Why:** The language-sync request explicitly expanded the prior local-only scope; the account's preference now needs to be shared across devices without changing other profile or authentication behavior.

**How to apply:** On sign-in, use the server value when present; when it is unset, carry forward an intentional guest selection or migrate that account's prior local value. Default new accounts and guests to English.

Bound delayed retries for API failures without disabling later connectivity- or resume-triggered retries.

**Why:** The phone can remain online during a brief API outage, but a later network recovery event may still be the only signal that the server is reachable again.

**How to apply:** Limit timer-driven retry attempts per selected preference; preserve the existing explicit network and app-resume retry paths, and scope all callbacks to the same account and language version.

For pending signed-in changes, compare against the server language last observed by that device. Accept the offline choice only while that baseline is still current; otherwise adopt and cache the server value.

**Why:** A stale pending write from an offline device must not silently reverse a newer choice made elsewhere.

**How to apply:** Preserve each pending choice's baseline through retries and use an atomic server-side compare-and-set. A conflict clears the stale pending write; a matching baseline keeps the existing retry behavior.
