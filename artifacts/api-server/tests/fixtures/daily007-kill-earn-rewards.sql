CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0),
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  game_mode text NOT NULL,
  team_type text NOT NULL CHECK (team_type IN ('solo', 'duo', 'squad')),
  kill_reward_coins integer NOT NULL DEFAULT 0 CHECK (kill_reward_coins >= 0),
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL,
  starts_at timestamptz NOT NULL
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  captain_name text NOT NULL,
  captain_game_name text,
  captain_game_uid text NOT NULL,
  assigned_group_number integer,
  status text NOT NULL
);

CREATE TABLE daily007_v2_squad_teams (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  team_number integer NOT NULL
);

CREATE TABLE daily007_v2_squad_team_members (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES daily007_v2_squad_teams(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE daily007_v2_result_awards (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  rank integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid,
  registration_id uuid,
  idempotency_key text UNIQUE,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_kill_earn_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  tournament_name text NOT NULL,
  submode text NOT NULL CHECK (submode IN ('solo', 'duo', 'squad')),
  player_name text NOT NULL,
  player_uid text NOT NULL,
  evidence_reference text CHECK (
    evidence_reference IS NULL OR (
      length(evidence_reference) <= 2048
      AND evidence_reference ~ '^https://[^[:space:]]+$'
    )
  ),
  verified_kills integer NOT NULL CHECK (verified_kills >= 0),
  reward_per_kill integer NOT NULL CHECK (reward_per_kill >= 0),
  reward_coins integer NOT NULL CHECK (reward_coins >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'credited')),
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  reviewed_at timestamptz,
  credited_at timestamptz,
  wallet_ledger_id uuid UNIQUE,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily007_v2_kill_earn_rewards_match_user_unique UNIQUE (match_id, user_id),
  CONSTRAINT daily007_v2_kill_earn_rewards_match_registration_unique UNIQUE (match_id, registration_id),
  CONSTRAINT daily007_v2_kill_earn_rewards_review_state_check
    CHECK ((status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
       OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT daily007_v2_kill_earn_rewards_credit_state_check
    CHECK ((status = 'credited' AND wallet_ledger_id IS NOT NULL AND credited_at IS NOT NULL)
       OR (status <> 'credited' AND wallet_ledger_id IS NULL AND credited_at IS NULL)),
  CONSTRAINT daily007_v2_kill_earn_rewards_rejection_check
    CHECK ((status = 'rejected' AND rejection_reason IS NOT NULL)
       OR (status <> 'rejected' AND rejection_reason IS NULL))
);

CREATE INDEX daily007_v2_kill_earn_rewards_match_status_created_idx
  ON daily007_v2_kill_earn_rewards (match_id, status, created_at DESC);
CREATE INDEX daily007_v2_kill_earn_rewards_user_created_idx
  ON daily007_v2_kill_earn_rewards (user_id, created_at DESC);
