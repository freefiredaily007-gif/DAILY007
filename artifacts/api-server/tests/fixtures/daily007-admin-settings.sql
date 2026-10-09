CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  auth_version integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_settings (
  id integer PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES daily007_v2_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
