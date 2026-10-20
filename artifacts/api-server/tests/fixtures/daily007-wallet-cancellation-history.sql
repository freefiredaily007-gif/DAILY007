CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'user',
  wallet_coins integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  mode text NOT NULL DEFAULT 'clash',
  game_mode text,
  team_type text,
  capacity integer NOT NULL DEFAULT 2,
  starts_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
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
  captain_name text NOT NULL,
  captain_game_uid text NOT NULL,
  entry_coins_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL
);

CREATE TABLE daily007_v2_result_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  rank integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  reason text NOT NULL,
  match_id uuid REFERENCES daily007_v2_matches(id),
  registration_id uuid,
  idempotency_key text UNIQUE,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
