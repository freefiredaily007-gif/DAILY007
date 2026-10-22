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
  enabled boolean NOT NULL,
  status text NOT NULL,
  starts_at timestamptz NOT NULL
);

CREATE TABLE daily007_v2_result_awards (
  match_id uuid NOT NULL,
  rank integer NOT NULL,
  prize_coins integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  captain_name text NOT NULL
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
