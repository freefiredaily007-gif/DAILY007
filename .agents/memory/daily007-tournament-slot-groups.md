---
name: Daily007 tournament seat assignments
description: Rules for keeping selected team and player slots stable across tournament formats.
---

Persist an explicitly selected group number on non-BR-Squad registrations. Team formats use it for the team; solo formats use it for the player's seat. Older clients may omit the selection and receive the first available group, but an explicit unavailable group must be rejected before any fee is charged. Keep BR Squad's existing slot API and semantics unchanged.

**Why:** The user chose persistence of the exact selected seat, and booked seats need to remain consistent across users and app restarts.

**How to apply:** Validate requested group numbers on the server while holding the match lock, and expose the saved group number in participant data so every mode can render the same occupancy.
