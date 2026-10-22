CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  wallet_coins integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active',
  auth_version integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL DEFAULT 'Test tournament',
  mode text NOT NULL DEFAULT 'solo',
  game_mode text DEFAULT 'battle_royale',
  team_type text DEFAULT 'solo',
  capacity integer NOT NULL DEFAULT 48,
  entry_coins integer NOT NULL DEFAULT 0,
  prize_pool integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL,
  status text NOT NULL,
  starts_at timestamptz NOT NULL,
  is_full boolean NOT NULL DEFAULT false,
  rules text NOT NULL DEFAULT '',
  banner text NOT NULL DEFAULT 'br',
  image_url text,
  prize_distribution text NOT NULL DEFAULT '',
  room_id text,
  room_password text,
  room_time text,
  room_published boolean NOT NULL DEFAULT false
);

CREATE TABLE daily007_v2_result_awards (
  match_id uuid NOT NULL,
  rank integer NOT NULL,
  prize_coins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  match_id uuid,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  captain_name text NOT NULL
);

CREATE TABLE daily007_v2_squad_team_members (
  registration_id uuid NOT NULL,
  team_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE daily007_v2_squad_teams (
  id uuid PRIMARY KEY
);

CREATE TABLE daily007_v2_roster (
  registration_id uuid NOT NULL
);

CREATE TABLE daily007_v2_payments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  balance_after integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
