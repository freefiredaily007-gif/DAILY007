---
name: Daily007 team result distribution
description: Product rules for winner selection and prize settlement in team-based Daily007 tournaments.
---

For team-based tournaments, an admin selects the winning team for rank one rather than one player. Distribute the entire prize pool equally among that team's approved, active registered players. Block publishing if the pool cannot be divided into whole coins. Record zero kills for each winner without changing their existing kill totals.

**Why:** the user explicitly chose equal whole-coin awards and zero new kills for team-winner publishing.

**How to apply:** preserve these rules in any future result-entry UI, settlement API, audit, or retry flow for team-based tournaments.
