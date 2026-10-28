---
name: Daily007 withdrawal UPI copying
description: Admin workflow for copying a player's payout UPI ID from a withdrawal request.
---

**Rule:** A player's UPI ID on an admin withdrawal request should be easy to copy exactly so the administrator can arrange the manual payout.

**Why:** The user asked for a copyable UPI ID in the admin wallet withdrawal section.

**How to apply:** Read the UPI ID from the withdrawal account details, copy it to the clipboard without transforming it, and keep approval and manual-payout recording behavior unchanged.

On 2026-10-07, the user confirmed that TalkBack on an iQOO Neo 10 running Android 16 handled the withdrawal UPI copy-success announcement as expected. No repeated announcement or focus movement was reported.

On 2026-10-09, the user reported that a non-sensitive test withdrawal UPI ID copied from AdminPayments pasted unchanged on Android. No payout details or screenshots were shared.

For Maestro checks of the copy-success banner, use a substring regex because the visible native text includes a decorative `✓` prefix. Exact text selectors can time out even while the success message is on screen.

**Why:** Android API 35 diagnostics showed the rendered `✓ Withdrawal UPI ID copied` text in the screen hierarchy and screenshot, while an exact Maestro text selector still failed.

**How to apply:** Match the message content with an expression that permits prefix/suffix decoration; keep the screen's user-facing accessibility announcement unchanged.

On 2026-10-28, Android API 35 showed Gboard covering a test-only paste field while Maestro long-pressed its stale underlying bounds; the keyboard exposed a clipboard suggestion instead of a Paste menu.

**Why:** A fixed-height fixture can leave the accessibility node present even though the IME covers the field, making a missing Paste selector look like a clipboard failure.

**How to apply:** Keep native clipboard test inputs visible above the Android keyboard with a `KeyboardAvoidingView` using `height` behavior before using long-press paste actions.