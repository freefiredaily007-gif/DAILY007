---
name: Daily007 iOS VoiceOver checks
description: Native confirmation requirements for VoiceOver behavior in the Linux-based workspace.
---

The workspace runs on Linux and does not provide Apple's simulator or device tools. Source tests and browser previews can verify the intended accessibility label but cannot confirm what VoiceOver speaks or how native focus traverses the screen.

On 2026-10-14, the user confirmed the My Matches published-result VoiceOver check was good; the exact spoken wording was not recorded.

**Why:** VoiceOver speech and native focus behavior vary by platform and cannot be established by static checks alone.

**How to apply:** For tasks that require iOS VoiceOver confirmation, keep the task open until the target flow is checked on an iPhone with VoiceOver enabled, or another suitable native iOS test environment.
