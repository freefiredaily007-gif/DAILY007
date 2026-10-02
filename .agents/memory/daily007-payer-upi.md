---
name: Daily007 payer UPI for recharges
description: Product requirement for payer UPI details on manual coin-recharge requests.
---

**Rule:** Add Coins collects the coin amount, the payer's UPI ID used for the transfer, and the transaction ID. Keep the payer's UPI ID distinct from the administrator's receiving UPI ID and make it available in the admin payment queue.

**Why:** The user requested the payer's UPI ID as an additional detail for manual payment verification.

**How to apply:** Store the payer UPI separately from the payment reference, display it to admins reviewing recharges, and leave the configured receiving UPI flow unchanged.