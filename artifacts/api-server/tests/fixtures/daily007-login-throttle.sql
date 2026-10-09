CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  clerk_user_id text UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  referral_code text,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'user',
  wallet_coins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_login_rate_limits (
  client_ip_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 1),
  expires_at timestamptz NOT NULL
);

CREATE INDEX daily007_login_rate_limits_expires_at_idx
  ON daily007_login_rate_limits (expires_at);
