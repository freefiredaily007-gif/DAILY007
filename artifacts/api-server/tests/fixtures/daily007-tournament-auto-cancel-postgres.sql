CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  wallet_coins integer NOT NULL CHECK (wallet_coins >= 0)
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  mode text NOT NULL,
  game_mode text,
  team_type text,
  capacity integer NOT NULL,
  starts_at timestamptz NOT NULL,
  status text NOT NULL,
  enabled boolean NOT NULL,
  is_full boolean NOT NULL,
  room_id text,
  room_password text,
  room_published boolean NOT NULL
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  entry_coins_paid integer NOT NULL CHECK (entry_coins_paid >= 0),
  status text NOT NULL
);

CREATE TABLE daily007_v2_result_awards (
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  rank integer NOT NULL
);

CREATE TABLE daily007_v2_wallet_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid REFERENCES daily007_v2_matches(id),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id),
  idempotency_key text NOT NULL UNIQUE,
  details jsonb NOT NULL
);

CREATE TABLE daily007_v2_settings (
  id integer PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
