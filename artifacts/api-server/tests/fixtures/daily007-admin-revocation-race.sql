CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0)
);

CREATE TABLE daily007_v2_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  coins integer NOT NULL CHECK (coins BETWEEN 1 AND 2147483647),
  amount integer NOT NULL,
  payer_upi_id text,
  reference_normalized text NOT NULL UNIQUE,
  reference text NOT NULL,
  proof_object_path text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  review_reason text,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE daily007_v2_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  coins integer NOT NULL CHECK (coins BETWEEN 1 AND 2147483647),
  method text NOT NULL,
  account text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  payout_status text NOT NULL DEFAULT 'not_paid'
    CHECK (payout_status IN ('not_paid', 'manual_payout_required', 'paid')),
  review_reason text,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);

CREATE TABLE daily007_v2_google_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  google_clerk_user_id text NOT NULL,
  google_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  review_note text,
  review_method text CHECK (review_method IS NULL OR review_method IN ('full_admin', 'owner_code')),
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL AND char_length(review_note) BETWEEN 10 AND 500)
  )
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  idempotency_key text UNIQUE,
  details jsonb,
  match_id uuid,
  registration_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  mode text NOT NULL DEFAULT 'solo',
  game_mode text NOT NULL DEFAULT 'battle_royale',
  team_type text NOT NULL DEFAULT 'solo',
  capacity integer NOT NULL DEFAULT 48,
  entry_coins integer NOT NULL DEFAULT 0,
  prize_pool integer NOT NULL DEFAULT 0,
  prize_distribution text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  enabled boolean NOT NULL DEFAULT true,
  is_full boolean NOT NULL DEFAULT false,
  room_id text,
  room_password text,
  room_published boolean NOT NULL DEFAULT false
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  captain_name text NOT NULL DEFAULT '',
  captain_game_name text NOT NULL DEFAULT '',
  team_name text,
  status text NOT NULL DEFAULT 'approved'
);

CREATE TABLE daily007_v2_result_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  rank integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily007_v2_result_awards_registration_id_unique UNIQUE (registration_id),
  UNIQUE (match_id, rank)
);

CREATE TABLE daily007_v2_user_stats (
  user_id uuid PRIMARY KEY REFERENCES daily007_v2_users(id),
  matches integer NOT NULL,
  wins integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL
);

CREATE TABLE daily007_v2_leaderboard_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_type text NOT NULL CHECK (cycle_type IN ('weekly', 'monthly')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('active', 'pending_approval', 'pending_activation', 'finalized')
  ),
  previous_period_id uuid REFERENCES daily007_v2_leaderboard_periods(id),
  final_standings jsonb,
  payout_configuration jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid REFERENCES daily007_v2_users(id),
  approved_at timestamptz,
  settled_at timestamptz,
  UNIQUE (cycle_type, starts_at)
);
