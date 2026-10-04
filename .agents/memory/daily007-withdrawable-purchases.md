---
name: Daily007 withdrawable purchases
description: Payment-rail constraint for coins that can be withdrawn as cash
---

Purchased Daily007 coins must remain withdrawable. The current UPI QR/reference path must remain manual: only admin approval credits coins. If an approved payment gateway is connected later, automatic coin credit may happen only after that provider verifies completed payment; a static UPI QR or customer-entered transaction reference does not provide that proof. Do not treat a standard store consumable purchase as a drop-in replacement for this cash-withdrawable wallet.

**Why:** The user explicitly confirmed that purchased coins must remain withdrawable and then supplied a manual-approval wallet specification to use until an approved gateway is available. No payment gateway approved for this model was connected at the time of confirmation.

**How to apply:** Before implementing instant credit, confirm the merchant has an approved provider for withdrawable gaming coins and use its authenticated server-side confirmation with idempotent wallet credit. Keep the current QR/reference path clearly manual unless it gains genuine provider verification.