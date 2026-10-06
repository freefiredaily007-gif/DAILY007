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

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  mode text NOT NULL,
  game_mode text,
  team_type text,
  capacity integer NOT NULL,
  entry_coins integer NOT NULL DEFAULT 0,
  prize_pool integer NOT NULL DEFAULT 0,
  prize_distribution text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  is_full boolean NOT NULL DEFAULT false
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  captain_name text NOT NULL,
  captain_game_name text NOT NULL DEFAULT '',
  captain_game_uid text NOT NULL,
  team_name text NOT NULL DEFAULT '',
  entry_coins_paid integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  UNIQUE (match_id, captain_user_id),
  CHECK (entry_coins_paid >= 0),
  CHECK (length(btrim(captain_game_uid)) > 0)
);

CREATE TABLE daily007_v2_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  member_uid text,
  member_name text NOT NULL,
  UNIQUE (registration_id, position)
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid REFERENCES daily007_v2_matches(id),
  registration_id uuid REFERENCES daily007_v2_registrations(id),
  idempotency_key text UNIQUE,
  details jsonb
);
