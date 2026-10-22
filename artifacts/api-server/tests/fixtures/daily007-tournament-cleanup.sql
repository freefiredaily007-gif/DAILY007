\ir daily007-tournament-results-concurrency.sql

-- Mirror the production schema after removing the two match-data references.
-- Ledger rows retain their original UUID values after expired match data is removed.
ALTER TABLE daily007_v2_wallet_ledger
  DROP CONSTRAINT IF EXISTS daily007_v2_wallet_ledger_match_id_fkey;
ALTER TABLE daily007_v2_wallet_ledger
  DROP CONSTRAINT IF EXISTS daily007_v2_wallet_ledger_registration_id_fkey;
