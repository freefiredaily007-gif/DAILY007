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
  details jsonb
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
