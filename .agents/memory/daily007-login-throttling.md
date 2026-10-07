---
name: Daily007 login throttling
description: Security and user-access policy for password login rate limits.
---

Password login throttling must be shared across the Daily007 v2 and compatibility endpoints and keyed by trusted client IP, not email or account. Known and unknown addresses must receive the same public response for an equal limit state; throttling should expire instead of creating permanent account lockouts.

**Why:** Account-keyed blocking lets an attacker deny a target access or infer whether an email exists; short-lived source-based limits bound repeated password-hash work without permanently locking the account.

**How to apply:** Preserve a common limiter for both password-login aliases, use a proxy-derived client IP, keep cooldown recovery bounded, and test known/unknown response equivalence across both routes.
