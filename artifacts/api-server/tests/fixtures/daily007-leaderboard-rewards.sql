CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL CHECK (role IN ('user', 'tournament_admin', 'admin')),
  auth_version integer NOT NULL DEFAULT 0,
  wallet_coins integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text
);

CREATE TABLE daily007_v2_leaderboard_reward_settings (
  cycle_type text PRIMARY KEY CHECK (cycle_type IN ('weekly', 'monthly')),
  first_place_coins integer NOT NULL DEFAULT 0,
  second_place_coins integer NOT NULL DEFAULT 0,
  third_place_coins integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES daily007_v2_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
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
