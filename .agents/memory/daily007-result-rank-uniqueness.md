---
name: Tournament result rank uniqueness
description: The serialization rule for result awards and the migration risk of historical duplicate placements.
---

**Rule:** Keep result submissions serialized on the tournament match row and check every rank before award, wallet, or stats writes. Do not add a unique `(match_id, rank)` database index until existing awards have been audited.

**Why:** The previous route rejected duplicate winners but allowed duplicate non-winning ranks. Historical awards may therefore contain repeated placements; adding a unique index could fail on existing data or require changing already-published results.

**How to apply:** Every result write path must lock the same match row before checking the rank. Before adding database-level uniqueness, run a read-only duplicate audit and get an explicit repair decision before modifying existing awards.
